"""Paneltec-specified shift rules; minute allocation avoids stacked penalties."""
from datetime import date,timedelta
from decimal import Decimal

def minute(value):
    h,m=map(int,value.split(':'))
    if not 0<=h<24 or not 0<=m<60:raise ValueError('Invalid shift time')
    return h*60+m

def calculate_shifts(shifts,rules):
    buckets={k:0 for k in ('ordinary','ot1','ot2','night','holiday_work','penalty_ordinary')}
    meals=0;days={};occupied=set()
    for shift in shifts:
        d=date.fromisoformat(str(shift['date']));start=minute(shift['start']);end=minute(shift['finish'])
        if shift.get('next_day'):end+=1440
        if not 0<end-start<=1440:raise ValueError('Finish must follow start; select next day for an overnight shift')
        unpaid=int(shift.get('break_minutes',0));bs=shift.get('break_start')
        if unpaid<0 or unpaid>=end-start:raise ValueError('Break must be shorter than the shift')
        if unpaid and not bs:
            zones=set()
            for m in range(start,end):
                actual=d+timedelta(days=m//1440);clock=m%1440
                zones.add('holiday' if shift.get('public_holiday') else 'night' if (actual.weekday()<5 or (d.weekday()<5 and m>=1440)) and (clock>=1080 or clock<360) else 'weekend'+str(actual.weekday()) if actual.weekday()>=5 else 'day')
            if len(zones)>1:raise ValueError('Enter the unpaid break start so day/night rates can be allocated correctly')
            break_start=end-unpaid
        else:break_start=minute(bs) if bs else end
        if break_start<start:break_start+=1440
        if unpaid and not start<=break_start<break_start+unpaid<=end:raise ValueError('Unpaid break must be within this shift')
        for m in range(start,end):
            key=(d+timedelta(days=m//1440),m%1440)
            if key in occupied:raise ValueError('Shifts overlap; correct the time entries')
            occupied.add(key)
            if break_start<=m<break_start+unpaid:continue
            days.setdefault(d,[]).append((m,shift))
    for day,minutes in sorted(days.items()):
        minutes.sort(key=lambda v:v[0]);worked=len(minutes)
        meals+=int(worked>=600)+int(worked>=840)
        for index,(m,shift) in enumerate(minutes):
            actual=day+timedelta(days=m//1440);clock=m%1440
            ordinary=index<456
            # Highest applicable rate wins; public holiday is explicitly rostered.
            if shift.get('public_holiday'):
                bucket='holiday_work'
                if ordinary:buckets['penalty_ordinary']+=1
            elif (actual.weekday()<5 or (day.weekday()<5 and m>=1440)) and (clock>=1080 or clock<360):
                bucket='night'
                if ordinary and shift.get('replacement_day_shift'):buckets['penalty_ordinary']+=1
            elif actual.weekday()==6:bucket='ot2'
            elif actual.weekday()==5:bucket='ot1' # existing Saturday rule retained
            else:bucket='ordinary' if ordinary else 'ot1' if index<576 else 'ot2'
            buckets[bucket]+=1
    return {**{k:float(Decimal(v)/60) for k,v in buckets.items()},'meal_count':meals}

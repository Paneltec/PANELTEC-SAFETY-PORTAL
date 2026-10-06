"""Westpac direct-entry payroll file serializer; no bank communication.
Source: https://www.westpac.com.au/content/dam/public/wbc/documents/pdf/col/olpimportaude.pdf
"""
import re
from datetime import date
from decimal import Decimal

ALLOWED = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 +-$!%&()*. /#=:;?,'[]_^@")

def text_field(value, width, label):
    value = str(value).strip()
    if not value or len(value) > width or any(c not in ALLOWED for c in value):
        raise ValueError(f"{label}: use 1–{width} supported ASCII characters; no line breaks")
    return value.ljust(width)

def bsb(value):
    value = str(value).replace('-', '')
    if not re.fullmatch(r'[0-9]{6}', value) or value == '000000':
        raise ValueError('BSB must contain six digits and cannot be all zeros')
    return value[:3] + '-' + value[3:]

def account(value):
    value = str(value).strip()
    if not re.fullmatch(r'[0-9]{1,9}', value) or not int(value):
        raise ValueError('Account number must contain 1–9 digits, preserving leading zeros')
    return value.rjust(9)

def cents(value):
    d = Decimal(str(value))
    if not d.is_finite() or d <= 0 or d*100 != (d*100).to_integral_value():
        raise ValueError('Each payment must be positive, in whole cents')
    n = int(d*100)
    if n > 9999999999:
        raise ValueError('Payment total exceeds the ABA amount field')
    return n

def make_aba(config, payments, payday):
    if not 1 <= len(payments) <= 500:
        raise ValueError('Westpac Online Banking export supports 1–500 positive wage payments')
    if not re.fullmatch(r'[0-9]{6}', config['direct_entry_id']):
        raise ValueError('Direct Entry ID must contain six digits')
    trace_bsb, trace_account = bsb(config['bsb']), account(config['account_number'])
    user = text_field(config['user_name'],26,'Payer name')
    remitter = text_field(config['remitter'],16,'Remitter')
    description = text_field(config['description'],12,'File description')
    when = date.fromisoformat(str(payday)).strftime('%d%m%y')
    lines = ['0'+' '*17+'01WBC'+' '*7+user+config['direct_entry_id']+description+when+' '*40]
    total = 0
    seen = set()
    def detail(bank,amount,code,reference):
        return ('1'+bsb(bank['bsb'])+account(bank['account_number'])+' '+code+str(amount).zfill(10)
            +text_field(bank['account_name'],32,'Account name')+text_field(reference,18,'Payment reference')
            +trace_bsb+trace_account+remitter+'00000000')
    for payment in payments:
        if payment['worker_id'] in seen:
            raise ValueError('Duplicate worker in bank file')
        seen.add(payment['worker_id'])
        amount=cents(payment['net']);total+=amount
        lines.append(detail(payment,amount,'53',config['reference']))
    if total>9999999999:
        raise ValueError('Batch total exceeds the ABA amount field')
    debit = total if config.get('balancing_entry') else 0
    if debit:
        lines.append(detail(config,debit,'13','PAYROLL CONTRA'))
    count=len(lines)-1
    lines.append('7999-999'+' '*12+str(total-debit).zfill(10)+str(total).zfill(10)+str(debit).zfill(10)+' '*24+str(count).zfill(6)+' '*40)
    if any(len(line)!=120 for line in lines):
        raise ValueError('Invalid ABA record length')
    return ('\r\n'.join(lines)+'\r\n').encode('ascii')

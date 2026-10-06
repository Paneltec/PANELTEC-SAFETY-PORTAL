"""Shared indigo/gold payslip presentation built only from immutable issue data."""
from datetime import date,timedelta
from html import escape
from io import BytesIO

def statement(snapshot,worker,week,issued):
    from fastapi import HTTPException
    row=next((r for r in snapshot['report']['rows'] if r['worker_id']==worker),None)
    if not row:raise HTTPException(404,'Employee not found in this issued run')
    b=snapshot['branding'];p=row['profile'];e=row['entry'];r=row['result'];rules=snapshot['worksheet']['rules'];division=b.get(b.get('assignments',{}).get(worker,''),{})
    lines=[('Ordinary hours',e['ordinary'],p['hourly_rate'],r['ordinary_pay']),('Overtime - tier 1',e['ot1'],p['hourly_rate']*rules['ot1_multiplier'],r['ot1_pay']),('Overtime - tier 2',e['ot2'],p['hourly_rate']*rules['ot2_multiplier'],r['ot2_pay']),('Annual leave',e['annual'],p['hourly_rate'],r['annual_pay']),('Personal / carer leave',e['personal'],p['hourly_rate'],r['personal_pay']),('Public holiday',e['public_holiday'],p['hourly_rate'],r['public_holiday_pay']),('Leave loading',None,None,r['leave_loading']),('Taxable allowances',None,None,r['taxable_allowances'])]
    return {'name':row['name'],'worker_id':worker,'brand':division.get('name') or 'Paneltec Pay','logo':division.get('logo',''),'employer':b['employer_name'],'abn':b['employer_abn'],'week':week,'end':(date.fromisoformat(week)+timedelta(days=6)).isoformat(),'paid_date':issued['paid_date'],'revision':snapshot['revision'],'profile':p,'entry':e,'result':r,'hours':sum(e.get(k,0) for k in ('ordinary','ot1','ot2','annual','personal','public_holiday')),'lines':[l for l in lines if l[1] or l[3] or l[0]=='Ordinary hours'],'masked':issued.get('particulars',{}).get(worker,{}),'issued_at':issued['issued_at']}

def money(v):return f'${float(v):,.2f}' if v is not None else 'Not available'
def qty(v):return f'{float(v):.2f}' if v is not None else '-'

def render_html(snapshot,worker,week,issued):
    d=statement(snapshot,worker,week,issued);h=lambda v:escape(str(v or ''));r=d['result'];p=d['profile'];e=d['entry']
    lines=''.join(f'<tr><td>{h(l)}</td><td>{qty(q)}</td><td>{money(rate) if rate is not None else "-"}</td><td>{money(v)}</td><td>Not loaded</td></tr>' for l,q,rate,v in d['lines'])
    totals=''.join(f'<tr><th colspan="3">{l}</th><td>{money(r[k])}</td><td>Not loaded</td></tr>' for l,k in [('Gross earnings','gross'),('PAYG withholding','payg'),('Other deductions','deductions'),('Reimbursements','reimbursements'),('Net payment','net'),('Employer super contribution required','super')])
    leave=''.join(f'<tr><td>{label}</td><td>{qty(r[k+"_accrued"])}</td><td>{qty(e[k])}</td><td>{qty(r[k+"_closing"])}</td></tr>' for label,k in [('Annual leave','annual'),('Personal / carer leave','personal')])
    logo=d['logo'];image=f'<img alt="Division logo" src="{h(logo)}">' if logo.startswith(('data:image/png;base64,','data:image/jpeg;base64,')) else ''
    return f'''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payslip</title><style>body{{font:14px Arial;color:#1e1b4b;max-width:850px;margin:0 auto}}header{{background:#1e1b4b;color:white;border-bottom:7px solid #f5a000;padding:24px}}header small{{color:#ffbf20;letter-spacing:3px}}main{{padding:25px}}h1{{margin:8px 0}}img{{max-height:55px;max-width:190px;background:white}}.cards{{display:flex;gap:12px;margin:24px 0}}.cards>div{{background:#f7f6fb;border-radius:12px;padding:14px;flex:1}}.cards strong{{display:block;font-size:21px}}table{{border-collapse:collapse;width:100%;margin:20px 0;font-size:13px}}th,td{{padding:8px;border-bottom:1px solid #e0dff0;text-align:right}}th:first-child,td:first-child{{text-align:left}}thead{{border-bottom:2px solid #1e1b4b}}small,footer{{color:#6b6a8a}}pre{{white-space:pre-wrap;font:inherit}}@page{{size:A4;margin:12mm}}@media(max-width:500px){{main{{padding:12px}}.cards{{flex-wrap:wrap}}table{{font-size:11px}}}}</style><header>{image}<small>PANELTEC GROUP</small><h1>{h(d['brand'])} · Payslip</h1><p>Week {h(week)} to {h(d['end'])} · Paid {h(d['paid_date'])}</p></header><main><h2>{h(d['name'])}</h2><p>{h(p['classification'])} · {h(p['employment_type'].replace('_',' '))}<br>Employee reference {h(worker)}</p><p><strong>{h(d['employer'])}</strong> · ABN {h(d['abn'])}<br>Base rate {money(p['hourly_rate'])} per hour · Revision {d['revision']}</p><div class="cards"><div>Hours paid<strong>{qty(d['hours'])}</strong></div><div>Gross earnings<strong>{money(r['gross'])}</strong></div><div>Super<strong>{money(r['super'])}</strong></div><div>Net payment<strong>{money(r['net'])}</strong></div></div><table><thead><tr><th>Pay components</th><th>Hours / units</th><th>Rate</th><th>This pay</th><th>Year to date</th></tr></thead><tbody>{lines}{totals}</tbody></table><p><small>Year-to-date balances have not been imported. Super is based on reviewed qualifying earnings; this payslip is not a fund receipt.</small></p><h3>Bank payment</h3><p>{h(d['masked'].get('account_name') or d['name'])} · {h(d['masked'].get('account_masked') or 'Account details not captured')} · {money(r['net'])}</p><h3>Super contributions</h3><p>{h(p.get('super_fund_name'))} · USI {h(p.get('super_fund_usi'))} · Member {h(d['masked'].get('member_masked') or 'Not captured')} · {money(r['super'])}</p><h3>Leave — projected, not posted</h3><table><thead><tr><th>Leave</th><th>Accrued (h)</th><th>Taken (h)</th><th>Projected balance (h)</th></tr></thead><tbody>{leave}</tbody></table><p><small>Long-service leave and RDO ledger balances are not maintained in this statement.</small></p><p>Allowance particulars:</p><pre>{h(e.get('allowance_details') or 'None')}</pre><p>Deduction particulars:</p><pre>{h(e.get('deduction_details') or 'None')}</pre><footer>Questions about your pay? Contact the pay officer. Issued {h(d['issued_at'])}.</footer></main></html>'''

def render_pdf(snapshot,worker,week,issued):
    from reportlab.platypus import SimpleDocTemplate,Paragraph,Spacer,Table,TableStyle,KeepTogether,Image
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet,ParagraphStyle
    from reportlab.lib.enums import TA_RIGHT
    from reportlab.lib.pagesizes import A4
    import base64
    d=statement(snapshot,worker,week,issued);r=d['result'];e=d['entry'];p=d['profile'];out=BytesIO();ink=colors.HexColor('#1e1b4b');gold=colors.HexColor('#f5a000');muted=colors.HexColor('#6b6a8a');line=colors.HexColor('#e0dff0');paper=colors.HexColor('#f7f6fb')
    styles=getSampleStyleSheet();styles.add(ParagraphStyle(name='Pay',fontName='Helvetica',fontSize=9,leading=13,textColor=ink));styles.add(ParagraphStyle(name='PaySmall',parent=styles['Pay'],fontSize=7.5,leading=10,textColor=muted));styles.add(ParagraphStyle(name='PayTitle',parent=styles['Pay'],fontName='Helvetica-Bold',fontSize=22,leading=27,textColor=colors.white));styles.add(ParagraphStyle(name='PayHead',parent=styles['Pay'],fontName='Helvetica-Bold',fontSize=11,leading=16));styles.add(ParagraphStyle(name='PayWhite',parent=styles['Pay'],textColor=colors.white));
    def para(t,style='Pay'):return Paragraph(escape(str(t)),styles[style])
    def table(rows,widths,head=True):
        rows=[[para(v) for v in row] for row in rows];t=Table(rows,colWidths=widths,repeatRows=1 if head else 0,hAlign='LEFT');cmd=[('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),6),('BOTTOMPADDING',(0,0),(-1,-1),6),('LINEBELOW',(0,0),(-1,0),1.2,ink),('LINEBELOW',(0,1),(-1,-1),.3,line)]
        if head:cmd.append(('BACKGROUND',(0,0),(-1,0),paper))
        t.setStyle(TableStyle(cmd));return t
    title=[para('PANELTEC GROUP','PayWhite'),para(d['brand'],'PayTitle'),para(f"Payslip · {week} to {d['end']} · Paid {d['paid_date']}",'PayWhite')]
    if d['logo'].startswith(('data:image/png;base64,','data:image/jpeg;base64,')):
        try:
            logo=Image(BytesIO(base64.b64decode(d['logo'].split(',',1)[1])));logo._restrictSize(110,36);title.insert(0,logo)
        except Exception:pass
    banner=Table([[title]],colWidths=[511]);banner.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,-1),ink),('BOX',(0,0),(-1,-1),0,ink),('LINEBELOW',(0,0),(-1,-1),5,gold),('LEFTPADDING',(0,0),(-1,-1),18),('TOPPADDING',(0,0),(-1,-1),16),('BOTTOMPADDING',(0,0),(-1,-1),16)]))
    story=[banner,Spacer(1,18),table([[d['name'],d['employer']],[f"{p['classification']} · {p['employment_type'].replace('_',' ')}",f"ABN {d['abn']}"],[f"Employee ID {worker}",f"Base pay rate {money(p['hourly_rate'])} per hour"],[f"Period {week} to {d['end']}",f"Date paid {d['paid_date']} · Revision {d['revision']}"]],[255,256],False),Spacer(1,12),table([['Hours paid','Gross earnings','Super','Net payment'],[qty(d['hours']),money(r['gross']),money(r['super']),money(r['net'])]],[127,128,128,128]),Spacer(1,15)]
    rows=[['Pay components','Hours','Rate','This pay','Year to date']]+[[l,qty(q),money(rate) if rate is not None else '-',money(v),'Not loaded'] for l,q,rate,v in d['lines']]
    rows += [[l,'','',money(r[k]),'Not loaded'] for l,k in [('Gross earnings','gross'),('PAYG withholding','payg'),('Other deductions','deductions'),('Reimbursements','reimbursements'),('Net payment','net'),('Employer super required','super')]]
    story += [table(rows,[199,50,70,80,112]),Spacer(1,8),para('Year-to-date balances have not been imported. Super uses reviewed qualifying earnings; this document is not a fund receipt.','PaySmall'),Spacer(1,12)]
    story += [KeepTogether([para('Bank payment','PayHead'),table([[d['masked'].get('account_name') or d['name'],d['masked'].get('account_masked') or 'Not captured',money(r['net'])]],[245,150,116],False)]),Spacer(1,10),KeepTogether([para('Super contributions','PayHead'),table([[p.get('super_fund_name') or 'Fund not captured',f"USI {p.get('super_fund_usi','')}",d['masked'].get('member_masked') or 'Member not captured',money(r['super'])]],[185,135,100,91],False)]),Spacer(1,12)]
    leave=[['Leave - projected, not posted','Accrued (h)','Taken (h)','Balance (h)']]+[[label,qty(r[k+'_accrued']),qty(e[k]),qty(r[k+'_closing'])] for label,k in [('Annual leave','annual'),('Personal / carer leave','personal')]]
    story += [table(leave,[220,97,97,97]),Spacer(1,8),para('Long-service leave and RDO ledger balances are not maintained in this statement.','PaySmall')]
    for label,key in [('Allowance particulars','allowance_details'),('Deduction particulars','deduction_details')]:
        if e.get(key):story += [Spacer(1,10),para(label,'PayHead'),para(e[key])]
    story += [Spacer(1,14),para(f"Questions about your pay? Contact the pay officer. Issued {d['issued_at']}.",'PaySmall')]
    def footer(canvas,doc):
        canvas.setFont('Helvetica',7);canvas.setFillColor(muted);canvas.drawString(42,23,'Private employee payslip');canvas.drawRightString(A4[0]-42,23,f'Page {doc.page}')
    SimpleDocTemplate(out,pagesize=A4,leftMargin=42,rightMargin=42,topMargin=30,bottomMargin=36,title='Paneltec payslip',author=d['employer']).build(story,onFirstPage=footer,onLaterPages=footer)
    return out.getvalue()

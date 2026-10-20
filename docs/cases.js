(function(root){
'use strict';
const LABEL='규정에 규정되어 있지 않은 사례';
const clean=s=>String(s||'').replace(/\s/g,'');
const visible = r => r && typeof r === 'object' &&
 (!Object.hasOwn(r,'state') || r.state === 'published') &&
 (!Object.hasOwn(r,'publicationStatus') || r.publicationStatus === 'published') &&
 (!Object.hasOwn(r,'publication_status') || r.publication_status === 'published') &&
 r.isPublished !== false && r.published !== false &&
 !['draft','archived','unpublished','withdrawn','inactive'].includes(r.status) &&
 (!Object.hasOwn(r,'mode') || r.mode === 'general');
const rows=()=>Array.isArray(root.CaseData?.cases)?root.CaseData.cases.filter(visible):[];
const literal=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/\s/g,'');
const customMatch=(record,question)=>{
 const q=literal(question);
 if(!q)return false;
 const keywords=Array.isArray(record.keywords)?record.keywords:[];
 if(keywords.some(k=>typeof k==='string'&&[...literal(k)].length>=2&&q.includes(literal(k))))return true;
 const saved=typeof record.question==='string'?literal(record.question):'';
 return [...saved].length>=2&&q===saved;
};
const scopeAllows=(record,team)=>record.scope==='all'||
 (record.scope==='headquarters'&&team?.direct===false)||
 (record.scope==='direct'&&team?.direct===true);
const choices=[{value:'unknown',label:'확인 필요'},{value:'yes',label:'네'},{value:'no',label:'아니요'}];
const field=(key,label,kind='select',options=choices)=>({key,label,kind,options});
const amountField=label=>field('amount',label,'money');
const validMoney=v=>/^[1-9]\d*$/.test(String(v??'').replaceAll(',',''))&&Number.isSafeInteger(Number(String(v).replaceAll(',','')));
const number=v=>Number(String(v).replaceAll(',',''));
function match(question){
 const q=clean(question);const ids=[];
 if(/해외지사/.test(q)&&/주재비|사업비|경비.*배정/.test(q))ids.push('case-01');
 if(/통품의|기본품의.*(?:세부|후속|사업자지정|변동|변경)/.test(q))ids.push('case-02');
 if(/(?:지원|참여)기업|기업.*선정/.test(q)&&/선정|결과/.test(q))ids.push('case-03');
 if(/선금|선급/.test(q))ids.push('case-04');
 if(/국내지사/.test(q)&&/예산|배정|사업비|운영비/.test(q))ids.push('case-05');
 if(/업무추진비|업추비|섭외성경비|잡비/.test(q))ids.push('case-06');
 if(/한국언론진흥재단|언론진흥재단|언진재/.test(q)&&/광고/.test(q))ids.push('case-07');
 // Edited built-in IDs with kind custom use only their saved matching rules.
 let builtins=rows().filter(r=>r.kind!=='custom'&&ids.includes(r.id));
 if(builtins.some(r=>['case-03','case-04','case-05'].includes(r.id)))builtins=builtins.filter(r=>r.id!=='case-02');
 const custom=rows().filter(r=>r.kind==='custom'&&customMatch(r,question));
 return [...builtins,...custom];
}
function moneyTokens(question){
 const units={'억':1e8,'억원':1e8,'천만원':1e7,'백만원':1e6,'만원':1e4,'원':1};
 return [...String(question).matchAll(/(\d+(?:\.\d+)?)\s*(억원|억|천만원|백만원|만원|원)/g)].map(m=>({value:Number(m[1])*units[m[2]],index:m.index,raw:m[0]}));
}
function facts(question,input={},record){
 const q=clean(question);const f={...input};
 const yes=(key,re)=>{if(re.test(q)&&(!f[key]||f[key]==='unknown'))f[key]='yes';};
 yes('approved',/승인된|승인받은|승인받았|전결로처리|결재받은|결재받았|기본품의가존재|통품의가존재/);
 if(/(?:통품의|기본품의)(?:가|는|도|서)?없|승인받지않|승인안받|승인전|미승인/.test(q))f.approved='no';
 yes('unchanged',/변경없|변동없|변경이없|변동이없|변경없이|변동없이|내용대로|내용에따른|내용에근거|내용에의거/);
 if(/변경(?:이|사항이)?있|변동(?:이|사항이)?있|변경하려|내용변경|방침을바꾸/.test(q))f.unchanged='no';
 yes('noAdvancePlan',/(?:선금|선급)(?:지급)?계획.{0,24}(?:없|미포함|불포함|포함되지않|포함되어있지않)|(?:본계약|기본품의|계약품의).{0,12}(?:없던|없었던).*(?:선금|선급)/);
 if(/(?:선금|선급)(?:지급)?계획.{0,12}(?:이미포함|포함되어있|포함돼있)/.test(q)&&!/(?:미포함|불포함|포함되지않|포함되어있지않)/.test(q))f.noAdvancePlan='no';
 yes('monthlySameExpense',/같은월.*같은업무|같은업무.*같은월|월누적|월합계|월내총|월총액/);
 if(/다른월|서로다른업무|별개업무/.test(q))f.monthlySameExpense='no';
 yes('noContract',/계약불포함|계약미포함|계약이없는|계약을포함하지않/);
 if(/새로운계약|신규계약|계약체결/.test(q))f.noContract='no';
 if(record.id==='case-01'&&!f.stage){if(/결의서|정산|가지급|가급/.test(q))f.stage='voucher';else if(/배정품의|배정.*품의|품의.*배정/.test(q))f.stage='plan';}
 const amounts=moneyTokens(question);
 if(!Object.hasOwn(input,'amount')){
  let contextual;
  if(record.id==='case-04')contextual=question.match(/(?:선금|선급)(?:을|은|으로|지출금액은|지급액은)?\s*(\d+(?:\.\d+)?\s*(?:억원|억|천만원|백만원|만원|원))/);
  if(record.id==='case-06')contextual=question.match(/(?:월\s*(?:누적|합계|총액)|총\s*지출)\s*(\d+(?:\.\d+)?\s*(?:억원|억|천만원|백만원|만원|원))/);
  if(contextual)f.amount=moneyTokens(contextual[1])[0]?.value;
  else if(amounts.length===1&&record.id!=='case-03')f.amount=amounts[0].value;
 }
 return f;
}
function packet(record,title,body,followups=[],pages=[]){
 const refs=[...new Set((pages.length?pages:(record.regulationRefs||[]).map(r=>r.page)).filter(page=>Number.isInteger(page)&&page>=1&&page<=38))];
 const sourceBase=record.kind==='custom'?record.sourceTitle:root.CaseData?.sourceTitle;
 const sourceTitle=typeof sourceBase==='string'&&sourceBase.trim()?sourceBase:'관리자 등록 사례';
 const start=record.sourceLines?.start,end=record.sourceLines?.end;
 const lines=Number.isInteger(start)&&Number.isInteger(end)&&start>0&&end>=start?` ${start}–${end}줄`:'';
 return {title,body:body+'\n사례의 적용 범위와 별도 직무별 규정·재위임·중요 또는 이례사항은 추가 확인해야 합니다.',source:`${LABEL} · 사례 ${record.number} · ${sourceTitle}${lines}`+(refs.length?' / 위임전결규정 PDF '+refs.join('·')+'쪽':''),type:LABEL,caseId:record.id,caseRecord:record,followups,citations:[{document:'cases',page:record.number},...refs.map(page=>({document:'regulation',page}))]};
}
function customAnswer(record,team,input={}){
 if(team?.team==='감사팀'||team?.team==='감사실')return packet(record,'감사 관련 별도 기준을 먼저 확인해야 합니다','감사실 관련 사항은 위임전결규정 제7조 제2항에 따라 별도로 정하도록 되어 있습니다. 등록된 일반 사례를 감사 조직에 자동 적용하지 않습니다.',[],[1]);
 if(!scopeAllows(record,team))return packet(record,'이 조직에 같은 사례를 적용할 수 있는지 확인이 필요합니다','관리자가 등록한 적용 조직과 현재 소속이 일치하지 않습니다. 적용 범위를 확인하기 전에는 이 사례의 답변을 결재 기준으로 안내하지 않습니다.');
 const conditions=Array.isArray(record.conditions)?record.conditions.filter(c=>typeof c==='string'&&c.trim()):[];
 if(input?.matchesCaseConditions==='no')return packet(record,'조건이 다른 경우에는 이 사례를 적용하지 않습니다','등록된 사례의 적용 조건이 현재 업무와 일치하지 않는 것으로 입력되었습니다. 해당 규정이나 다른 사례를 확인해 주세요.');
 if(input?.matchesCaseConditions!=='yes')return pending(record,[field('matchesCaseConditions','등록된 사례의 적용 조건과 현재 업무가 모두 일치하나요?')],
 '등록된 사례의 적용 조직·업무 범위를 확인해 주세요.'+(conditions.length?'\n'+conditions.map(c=>'· '+c).join('\n'):'\n상세 적용 조건이 기재되지 않았으므로 업무 내용과 적용 범위를 별도로 확인해야 합니다.'));
 if(typeof record.answer!=='string'||!record.answer.trim())return packet(record,'등록된 사례의 답변을 확인해야 합니다','이 사례에는 안내할 답변이 등록되어 있지 않습니다. 관리자의 검토가 필요합니다.');
 return packet(record,'등록된 사례에서는 다음과 같이 안내합니다',record.answer);
}
function pending(r,fields,body=r.summary){return packet(r,'사례를 적용할 조건을 확인해 주세요',body,fields);}
function planRole(amount,change=false){
 if(change)return amount<=3e8?'팀장':amount<=1e9?'실장':'본부장';
 return amount<=1e8?'팀장':amount<=3e8?'실장':amount<=1e9?'본부장':'사장';
}
function voucherRole(amount){return amount<=3e8?'팀장':amount<=1e9?'실장':'본부장';}
function resolve(team,question,options={}){
 if(options.mode==='deputy'||!rows().length)return null;
 const matches=options.caseId?rows().filter(r=>r.id===options.caseId):match(question);
 if(!matches.length)return null;
 if(matches.length>1)return {title:'여러 사례가 관련되어 있습니다',body:'서로 다른 사례의 적용 조건을 섞지 않도록 확인할 사례를 선택해 주세요.',source:LABEL,type:LABEL,caseMatches:matches};
 const r=matches[0];
 if(r.kind==='custom')return customAnswer(r,team,options.caseConditions||{});
 if(team.direct||team.team==='감사팀')return packet(r,'이 조직에 같은 사례를 적용할 수 있는지 확인이 필요합니다','등록 자료의 적용 조직 범위가 확정되어 있지 않습니다. 현재 사례의 금액·직위 구조는 본부 소속을 기준으로 연결했습니다. 사장직속·감사 조직에 같은 전결권자를 자동 적용하지 않습니다.');
 const q=clean(question),f=facts(question,options.caseConditions||{},r);
 const fields=[];
 const want=(key,label)=>{if(!['yes','no'].includes(f[key]))fields.push(field(key,label));};
 const wantMoney=label=>{if(!validMoney(f.amount))fields.push(amountField(label));};
 if(r.id==='case-01'){
  if(!['plan','voucher'].includes(f.stage))fields.push(field('stage','배정 품의인가요, 실제 지출의 가지급·정산결의서인가요?','select',[{value:'unknown',label:'선택해 주세요'},{value:'plan',label:'주재비·사업비 배정 품의'},{value:'voucher',label:'가지급·정산 등 지출결의서'}]));
  wantMoney('해당 단계의 금액 (원)');if(fields.length)return pending(r,fields);
  const amount=number(f.amount),isVoucher=f.stage==='voucher';
  const role=isVoucher?voucherRole(amount):(amount<=1e8?'팀장':'실장');
  return packet(r,`${role} 전결 기준에 해당합니다`,`${isVoucher?'지출결의서':'해외지사 주재비·사업비 배정 품의'} ${amount.toLocaleString('ko-KR')}원 기준입니다. 배정 품의는 PDF 21쪽, 가지급·정산결의서는 PDF 14쪽의 서로 다른 금액 기준으로 구분했습니다.`,[],[isVoucher?14:21]);
 }
 if(r.id==='case-02'||r.id==='case-03'){
  want('approved','근거가 되는 기본·통품의가 이미 승인되었나요?');want('unchanged','이번 업무는 승인된 기본방침을 바꾸지 않는 세부 실행인가요?');
  if(fields.length)return pending(r,fields);
  if(f.approved==='no')return packet(r,'승인된 기본품의가 없는 경우에는 이 결론을 적용하지 않습니다','팀장 전결 안내는 이미 승인된 기본·통품의의 후속 세부 실행에 대한 사례입니다. 처음 결정하는 사업이나 계약은 해당 기본방침 결정 기준을 별도로 확인해야 합니다.');
  if(f.unchanged==='no'){
   want('noContract','이번 기본방침 변경은 계약이 불포함된 예산집행 계획 변경인가요?');wantMoney('변경 품의서의 예산 총액 (추가액만이 아닌 총액 · 원)');
   if(fields.length)return pending(r,fields,'기본방침이 바뀌면 후속 실행의 팀장 기준을 자동 적용하지 않습니다.');
   if(f.noContract==='no')return packet(r,'계약을 포함한 변경은 계약 관련 규정을 확인해야 합니다','8. 예산집행 계획수립은 계약이 불포함된 경우의 기준입니다. 계약의 변경·해지·해제 등 해당 처리 단계를 별도로 확인해 주세요.');
   const amount=number(f.amount);return packet(r,`${planRole(amount,true)} 전결 기준에 해당합니다`,`기본방침 변경은 변경 품의 예산 총액 ${amount.toLocaleString('ko-KR')}원에 대해 8. 예산집행 계획수립 > 2. 기본방침의 변경 기준을 확인했습니다.`,[],[12]);
  }
  if(/지출결의|정산결의|가지급|가급/.test(q)){
   wantMoney('지출결의서 금액 (원)');if(fields.length)return pending(r,fields,'세부 실행의 팀장 사례를 지출결의서의 명시적 금액 기준에 무조건 우선하지 않습니다.');
   const amount=number(f.amount);return packet(r,`${voucherRole(amount)} 전결 기준을 함께 확인해야 합니다`,`지출결의서 ${amount.toLocaleString('ko-KR')}원은 별표 Ⅱ의 10. 경비의 집행 > 1. 지출결의서 기준입니다. 통품의 후속 업무 사례를 근거로 명시된 금액 기준을 건너뛰지 않습니다.`,[],[14]);
  }
  return packet(r,'사례상 팀장 전결로 안내합니다','이미 승인된 기본·통품의 내용에 근거하고 기본방침의 변경이 없는 '+(r.id==='case-03'?'지원기업 선정 결과 품의':'사업자 지정 등 세부 실행')+'에 대한 안내입니다. 새 계약의 체결이나 별도 지출결의서의 명시적 기준까지 팀장 전결로 바꾸는 사례는 아닙니다.');
 }
 if(r.id==='case-04'){
  want('noAdvancePlan','본계약 품의에 이번 선금지급계획이 포함되어 있지 않나요?');wantMoney('이번 선금 지출 결정액 (총계약액이 아닌 선금액 · 원)');if(fields.length)return pending(r,fields);
  if(f.noAdvancePlan==='no')return packet(r,'선금계획이 이미 포함된 경우에는 같은 사례를 적용하지 않습니다','등록 사례는 본계약 품의에 선금지급계획이 없었던 상황입니다. 계획이 포함되어 있다면 승인 내용, 집행 단계와 별도 지출결의 기준을 확인해야 합니다.');
  const amount=number(f.amount);return packet(r,`${planRole(amount)} 전결 기준에 해당합니다`,`등록된 최종 정정 답변에 따라 이번 선금 ${amount.toLocaleString('ko-KR')}원의 별도 지출 결정을 8. 예산집행 계획수립 > 1. 기본방침의 결정으로 연결했습니다. 총계약액이나 초기 답변의 9. 계약 관련 기준으로 계산하지 않았습니다. 원래 사례는 총계약 8억원·선금 2억원으로 실장 전결을 안내한 건입니다.`,[],[12]);
 }
 if(r.id==='case-05'){
  want('approved','배정의 근거가 되는 통품의·집행계획이 이미 승인되었나요?');
  if(f.approved==='yes')want('unchanged','승인된 범위 안에서 변경 없이 지사별로 나눠 배정하나요?');if(fields.length)return pending(r,fields);
  if(f.approved==='yes'&&f.unchanged==='yes')return packet(r,'사례상 팀장 전결 기준으로 연결합니다','이미 승인된 통품의의 범위 안에서 국내지사별로 나눠 배정·승인하는 상황입니다. PDF 26쪽 국내조직망 사업비·운영비 승인·배정 항목을 연결했습니다. 기본방침 자체가 바뀌는 배정에는 이 결론을 적용하지 않습니다.',[],[26]);
  want('noContract','계약이 불포함된 예산집행 계획의 결정·변경인가요?');wantMoney('기본품의 예산 총액 (원)');if(fields.length)return pending(r,fields);
  if(f.noContract==='no')return packet(r,'계약 포함 여부와 처리 단계를 별도로 확인해 주세요','8항의 계약 불포함 기준을 계약이 있는 품의에 자동 적용하지 않습니다.');
  const amount=number(f.amount),change=f.approved==='yes';return packet(r,`${planRole(amount,change)} 전결 기준에 해당합니다`,`${change?'기본방침이 바뀌는':'승인된 통품의가 없는 최초'} 배정이므로 예산 총액 ${amount.toLocaleString('ko-KR')}원으로 8. 예산집행 계획수립 > ${change?'2. 기본방침의 변경':'1. 기본방침의 결정'}을 확인했습니다.`,[],[12]);
 }
 if(r.id==='case-06'){
  want('monthlySameExpense','같은 월·같은 업무추진비의 추가 사후품의인가요?');wantMoney('기존 지출과 추가 지출을 합한 월 총액 (원)');if(fields.length)return pending(r,fields);
  if(f.monthlySameExpense==='no')return packet(r,'다른 월이나 다른 업무는 이 합산 사례와 구분해야 합니다','등록 사례는 같은 월·같은 업무의 기존 50만원과 추가 50만원을 합친 건입니다. 적용 조건이 다르면 같은 결론으로 처리하지 않습니다.');
  const amount=number(f.amount),role=amount<=500000?'팀장':amount<=1000000?'실장':'본부장';return packet(r,`${role} 전결 기준에 해당합니다`,`같은 월·같은 업무의 합계 ${amount.toLocaleString('ko-KR')}원을 기준으로 확인했습니다. 원래 사례의 50만원 + 50만원 = 100만원은 실장 전결입니다. 월 합계가 100만원을 초과하면 별표 Ⅱ의 “섭외성 경비, 잡비” 기준은 본부장이므로 실장 사례를 무제한 확장하지 않습니다.`,[],[12]);
 }
 if(r.id==='case-07'){
  want('noContract','계약 체결·변경이나 정산이 아닌 8항에 해당하는 광고 예산 기본방침 결정 품의인가요?');wantMoney('광고 기본품의의 예산 총액 (원)');if(fields.length)return pending(r,fields);
  if(f.noContract==='no'||/정산|계약체결|계약변경/.test(q))return packet(r,'기본방침 결정 외의 광고 업무에는 같은 사례를 자동 적용하지 않습니다','이 사례는 한국언론진흥재단 광고 관련 기본방침 결정에 8항을 참고한다는 안내입니다. 모든 광고 계약·체결·변경·정산으로 확대하지 않습니다.');
  const amount=number(f.amount);return packet(r,`${planRole(amount)} 전결 기준에 해당합니다`,`한국언론진흥재단 광고의 기본방침 결정 품의에 대해 예산 총액 ${amount.toLocaleString('ko-KR')}원으로 8. 예산집행 계획수립 > 1. 기본방침의 결정을 연결했습니다. 다른 광고기관이나 다른 업무 단계로 일반화하지 않습니다.`,[],[12]);
 }
 return null;
}
const api={resolve,match,facts,label:LABEL};root.Cases=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);

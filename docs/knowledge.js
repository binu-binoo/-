(function(root){
 const data=()=>root.RegulationData;
 const norm=s=>String(s).toLowerCase().replace(/[\s.,·ㆍ‧()「」\[\]?!…:;<>]/g,'');
 function terms(q){
  q=q.replace(/연차|연가/g,'휴가').replace(/실장님/g,'실장').replace(/센터장님/g,'센터장').replace(/팀장님/g,'팀장').replace(/국내출장/g,'국내 출장').replace(/해외출장|국외출장/g,'해외 출장');
  const stop=['누구','누가','인가요','어떻게','알려','궁금','하려고','하려','올리려고','전결권자','결재권자','전결','결재','질문','본부소속','사장직속','조직에서','소속','규정','할까요','필요','대한'];
  let n=norm(q);for(const t of stop)n=n.replaceAll(t,' ');
  const words=n.replace(/[0-9]+(?:억|천|만)?원?/g,' ').split(/[^가-힣a-z]+/).filter(Boolean);
  const grams=new Set();for(const word of words){for(let size=2;size<=Math.min(5,word.length);size++)for(let i=0;i<=word.length-size;i++)grams.add(word.slice(i,i+size));}
  return [...grams];
 }
 function search(question,team){
  const query=terms(question);if(!query.length)return [];
  const docs=data().entries.filter(e=>e.scope==='III'||e.scope===(team.direct?'I':'II'));
  const normalized=docs.map(e=>norm(e.context));
  const freq=new Map(query.map(t=>[t,normalized.filter(s=>s.includes(t)).length]));
  return docs.map((e,i)=>{
   const row=norm(e.text);let score=0;let hits=[];
   for(const t of query)if(normalized[i].includes(t)){score+=(1+Math.log((docs.length+1)/(freq.get(t)+1)))*(row.includes(t)?1.5:1)*Math.pow(t.length,3);hits.push(t);}
   return {...e,score,hits};
  }).filter(e=>e.score>0).sort((a,b)=>b.score-a.score).filter((e,i,a)=>a.findIndex(x=>x.page===e.page&&x.text===e.text)===i).slice(0,8);
 }
 function matchEntry(question,team){
  const q=norm(question);
  // Amounts and conditional statements must use the explicit workflow or source review.
  if(/[0-9]|금액|이하|초과|미만|경우|변경|계약|휴가|출장|근태|부재|유고|대결/.test(q))return null;
  const core=q.replace(/전결권자는|전결권자가|결재권자는|결재권자가|전결권자|결재권자|누구인가요|누구야|누구|누가|전결인가요|전결이야|전결|결재하나요|결재|알려주세요|알려줘|인가요|어떻게하나요|어떻게|하나요|규정상|규정에서/g,'').replace(/(은|는|을|를|이|가|의)/g,'');
  if(core.length<4)return null;
  const canon=s=>norm(s).replace(/[0-9]+/g,'').replace(/(은|는|을|를|이|가|의)/g,'');
  const matches=data().entries.filter(e=>(e.scope==='III'||e.scope===(team.direct?'I':'II'))&&canon(e.text).includes(core)&&!/[0-9]+억|[0-9]+만|이하|초과|미만|경우|단,/.test(e.text));
  // A direct table statement needs a unique matching work item.
  if(matches.length!==1)return null;
  const entry=matches[0];
  return {title:entry.authority+' 전결로 표시되어 있습니다',body:'해당 표 항목: '+entry.text+'\n직무별 사항은 해당 업무 범위에 적용됩니다. 주변 조건 및 재위임·중요 또는 이례사항을 원문에서 함께 확인해 주세요. 표의 전결권 표시는 자동 추출한 것으로 원문 확인이 필요합니다.',source:`별표 ${entry.scope==='I'?'Ⅰ':entry.scope==='II'?'Ⅱ':'Ⅲ'} · PDF ${entry.page}쪽`,type:'일치하는 표 항목 · 원문 확인 필요',candidates:[entry]};
 }
 function searchText(question){
  const query=terms(question);const exact=norm(question);if(!exact)return [];
  const chunks=data().pages.flatMap(p=>p.text.split(/\n\s*\n/).filter(t=>t.trim()).map(text=>({page:p.page,text:text.trim()})));
  const freq=new Map(query.map(t=>[t,chunks.filter(c=>norm(c.text).includes(t)).length]));
  return chunks.map(c=>{const n=norm(c.text);return {...c,score:(exact.length>=3&&n.includes(exact)?1000000:0)+query.reduce((sum,t)=>sum+(n.includes(t)?Math.pow(t.length,3)*(1+Math.log((chunks.length+1)/(freq.get(t)+1))):0),0)};}).filter(c=>c.score>0).sort((a,b)=>b.score-a.score).slice(0,4);
 }
 function resolve(team,question){
  const q=norm(question).replace(/연차|연가/g,'휴가');
  const result=(title,body,source,type='규정 근거')=>({title,body,source,type});
  if((team.direct&&q.includes('본부소속'))||(!team.direct&&q.includes('사장직속')))return result('질문한 조직과 선택한 팀이 다릅니다','소속 팀을 변경하거나 질문에서 어느 조직의 기준을 확인하려는지 정리해 주세요.','사용자가 제공한 조직 분류 기준','추가 확인 필요');
  if(team.team==='감사팀')return null; // Rules.answer handles the separate audit rule.
  if(/중복|겹치/.test(q))return result('별표의 전결권이 중복되면 최하위직이 우선합니다','별표의 위임전결내용 상호 간 위임전결권이 중복되는 사항에 적용합니다. 서로 다른 업무나 처리 단계를 하나로 합쳐 적용하는 기준은 아닙니다.','제4조 제3항 · PDF 1쪽');
  if(/재위임/.test(q))return result('일부 전결사항은 하급직위자에게 재위임할 수 있습니다','각 실·센터 등은 일부 전결사항을 파트장 등에게 재위임할 수 있습니다. 재위임되지 않은 사항은 본 규정을 따릅니다. 실제 재위임 내역은 이 공개 규정만으로 확인할 수 없습니다.','제5조 제1항·제2항 · PDF 1쪽');
  if(/미합의|협의가안|합의가안/.test(q))return result('차상급 이상 직위자의 결정에 따릅니다','타부서 관련 사항은 협의해야 하며, 미합의 시 차상급 이상 직위자의 결정에 따릅니다.','제8조 · PDF 1쪽');
  if(/이례|중요한사항|중요사항/.test(q))return result('사전에 차상급 직위자의 지시를 받아야 합니다','위임전결사항이라도 중요 또는 이례로 인정되는 사항은 사전에 차상급 직위자의 지시를 받아야 합니다.','제7조 제1항 · PDF 1쪽');
  const leave=/휴가|근태|조퇴|외출(?!장)|결근|지각/.test(q), travel=/출장/.test(q);
  if(!leave&&!travel)return null;
  if(/임금피크|별도직무|파견|재위임|대결|유고|부재|상벌|취소|변경/.test(q))return null;
  if(leave&&travel)return result('휴가·근태와 출장 중 어떤 업무인가요?','업무마다 전결 기준이 달라 질문을 나누어 주세요. 출장이라면 국내·해외 여부도 알려주세요.','별표 Ⅰ·Ⅱ · 복무 및 직무 관리 / 국내외 출장','추가 확인 필요');
  if(travel&&/출장결의서|출장비|여비|경비/.test(q))return null;
  const subjects=['본부장','실장','센터장','팀장','지사장','파트장','팀원'].filter(s=>q.includes(s));
  if(subjects.length!==1)return result('누구의 '+(travel?'출장':'휴가·근태')+'인가요?','본부장·실장·센터장·팀장·지사장·파트장·팀원 중 대상을 알려주세요. 여러 대상이면 질문을 각각 나누어 주세요.','별표 Ⅰ·Ⅱ · 복무 및 직무 관리 / 국내외 출장','추가 확인 필요');
  const target=subjects[0];
  if(!team.direct&&target==='팀원'&&/본부소속직원|실소속직원|본부직원|실직원/.test(q))return null;
  const overseas=/해외|국외/.test(q),domestic=/국내/.test(q);
  if(travel&&overseas===domestic)return result('국내출장인가요, 해외출장인가요?','출장 명령·복명의 전결 기준은 국내·해외에 따라 다릅니다. 질문에 국내 또는 해외를 명시해 주세요.','별표 '+(team.direct?'Ⅰ · PDF 7쪽':'Ⅱ · PDF 11쪽')+' · 2. 국내외 출장','추가 확인 필요');
  let authority;
  if(team.direct){
   if(!['실장','팀장','팀원'].includes(target))return null;
   authority=target==='실장'?'사장':target==='팀장'?'실장':travel&&overseas?'실장':'팀장';
  }else{
   if(leave){
    if(target==='본부장'&&!/휴가/.test(q))return null;
    authority=target==='본부장'?'사장':['실장','센터장'].includes(target)?'본부장':target==='팀원'?'팀장·지사장·파트장':'실장·센터장';
    if(target==='지사장'&&/외출/.test(q))return result('국내지사장의 관할지역 내 외출인가요?','국내지사장의 관할지역 내 외출은 지사장 전결입니다. 그 외 근태는 별도 해당 항목을 확인해야 합니다.','별표 Ⅱ · 1. 복무 및 직무 관리 · 2. 휴가, 근태 · PDF 11쪽','추가 확인 필요');
   }else{
    if(target==='지사장'&&domestic&&!/국내지사장/.test(q))return result('국내지사장인가요, 해외지사장인가요?','지사 종류에 따라 별표 Ⅱ 또는 별표 Ⅲ의 해외조직망 기준을 확인해야 합니다.','별표 Ⅱ PDF 11쪽 / 별표 Ⅲ PDF 36~38쪽','추가 확인 필요');
    authority=target==='본부장'?'사장':['실장','센터장'].includes(target)?'본부장':overseas?(target==='팀원'?'실장·센터장':'본부장'):(target==='팀원'||target==='지사장'?'팀장·지사장·파트장':'실장·센터장');
   }
  }
  const task=travel?(overseas?'해외출장 명령 및 복명':'국내출장 명령 및 복명'):'휴가·근태';
  return result(authority+' 전결입니다',`${team.direct?'사장직속':'본부 소속'} 조직의 ${target} ${task} 항목 기준입니다.\n${team.direct&&authority==='실장'?'다만 실에 속하지 않는 독립 팀이면 별표 Ⅰ 머리말에 따라 실장 전결사항을 사장이 전결합니다.\n':''}별도 재위임·직무별 기준·유고·중요 또는 이례사항이 있으면 해당 조건을 추가로 확인해야 합니다.`,`별표 ${team.direct?'Ⅰ':'Ⅱ'} → ${travel?'2. 국내외 출장':'1. 복무 및 직무 관리'} → ${task} → ${target} · PDF ${team.direct?7:11}쪽`);
 }
 root.Knowledge={search,searchText,matchEntry,resolve,terms};
 if(typeof module!=='undefined')module.exports=root.Knowledge;
})(globalThis);

(function(root){
 const direct=['안전경영팀','비서팀','홍보팀','감사팀'];
 function classify(value){const team=value.replace(/\s/g,'');if(!/^[가-힣A-Za-z0-9·ㆍ-]{2,38}팀$/.test(team))throw new Error('정확한 팀명을 “팀”까지 입력해 주세요.');return {team,direct:direct.includes(team)};}
 function contract(team, details){
 const {method,stage,amount,vat,approved,eligible,standalone}=details;
 const missing=[];
 if(!['bid','private'].includes(method))missing.push('계약 방식');
 if(!['plan','sign','change'].includes(stage))missing.push('처리 단계');
 const n=Number(amount);
 if(!String(amount??'').trim()||!Number.isSafeInteger(n)||n<=0)missing.push('부가세 제외 계약 총액(원 단위 양의 정수)');
 if(vat!==true)missing.push('부가세 제외 금액 확인');
 if(method==='private'&&eligible!==true)missing.push('관련 법규의 수의계약 사유 해당 여부');
 if(stage==='sign'&&approved!==true)missing.push('기본품의 승인 여부');
 if(team.direct&&!['yes','no'].includes(standalone))missing.push('실에 속하지 않는 독립 팀인지 여부');
 if(missing.length)return {title:'몇 가지 조건을 더 알려주세요',body:missing.join(' / '),source:'계약 관련 별표 Ⅰ(PDF 8쪽) 또는 Ⅱ(PDF 12~13쪽)',type:'추가 확인 필요'};
 const president='사장',division='본부장',office=team.direct?'실장':'실장·센터장',lead=team.direct?'팀장':'팀장·지사장·파트장';
 let levels;
 if(method==='private'){
  levels=stage==='plan'?(team.direct?[[20000000,lead],[100000000,office],[Infinity,president]]:[[20000000,lead],[50000000,office],[100000000,division],[Infinity,president]]):(team.direct?[[100000000,office],[Infinity,president]]:[[50000000,lead],[100000000,office],[Infinity,division]]);
 }else{
  levels=stage==='plan'?(team.direct?[[300000000,lead],[1000000000,office],[Infinity,president]]:[[100000000,lead],[300000000,office],[1000000000,division],[Infinity,president]]):(team.direct?[[1000000000,office],[Infinity,president]]:[[300000000,lead],[1000000000,office],[Infinity,division]]);
 }
 let authority=levels.find(([max])=>n<=max)[1];
 const substituted=team.direct&&standalone==='yes'&&authority===office;
 if(substituted)authority=president;
 return {title:authority+' 전결 기준에 해당합니다',body:`${team.team} · ${team.direct?'사장직속':'본부 소속'}\n${method==='private'?'수의계약':'경쟁입찰·정부 쇼핑몰 3자단가 구매'} · ${{plan:'기본방침 결정',sign:'기본품의에 근거한 계약체결',change:'계약의 변경·해지·해제'}[stage]}\n부가세 제외 계약 총액 ${n.toLocaleString('ko-KR')}원\n${substituted?'실에 속하지 않는 팀이므로 실장 전결사항을 사장 전결로 적용했습니다.\n':''}별표의 중복 기준은 제4조 제3항에 따라 최하위직 기준을 적용했습니다. 별표 Ⅲ의 직무별 사항, 재위임, 중요·이례사항은 추가 검토해야 합니다.`,source:`별표 ${team.direct?'Ⅰ · PDF 8쪽':'Ⅱ · PDF 12~13쪽'} · 9. 계약 관련 · 1. 기본품의서 · ${{plan:'1)',sign:'2)',change:'3)'}[stage]} / 제4조 제3항${substituted?' / 별표 Ⅰ 머리말(PDF 7쪽)':''}`,type:'규정 기준 · 입력 조건에 따른 안내'};
 }
 function answer(team,question,details,options={}){
 if(options.mode==='deputy'){
  if(!root.ManualData?.pages?.length||!root.Deputy)return {title:'대결 매뉴얼을 불러오지 못했습니다',body:'이 버전에는 대결 매뉴얼이 포함되지 않았습니다. 위임전결규정의 일반 전결권자를 대결권자로 대신 안내하지 않습니다.',source:'대결 매뉴얼 연결 확인 필요',type:'자료 확인 필요'};
  return root.Deputy.answer(team,question,options.conditions||{});
 }
 if(options.mode==='general'&&/대결/.test(question))return {title:'대결 유형을 선택해 주세요',body:'결재 유형을 “대결”로 변경하면 매뉴얼의 업무 범위와 위임 조건을 확인해 안내합니다.',source:'첫 화면의 결재 유형 선택',type:'결재 유형 확인 필요'};
 const q=question.replace(/\s/g,'');const scope=team.direct?'Ⅰ':'Ⅱ';
 const result=(title,body,source,type='규정 근거 · 샘플 안내')=>({title,body,source,type});
 if(team.team==='감사팀')return result('감사 관련 별도 기준 확인이 필요해요','제7조 제2항은 감사실에 관한 사항을 별도로 정하도록 하고 있습니다. 감사팀에 적용되는 별도 기준과 해당 업무의 적용 범위를 담당자에게 확인해 주세요.','제7조 제2항 · PDF 1쪽','별도 기준 확인 필요');
 if(root.Knowledge&&((team.direct&&q.includes('본부소속'))||(!team.direct&&q.includes('사장직속')))){const mismatch=root.Knowledge.resolve(team,question);if(mismatch)return mismatch;}
 if(root.Cases){
  const example=root.Cases.resolve(team,question,{...options,mode:'general'});
  if(example?.caseRecord?.kind==='custom'&&root.Knowledge){
   const explicit=root.Knowledge.resolve(team,question)||root.Knowledge.matchEntry(question,team);
   if(explicit&&['규정 근거','일치하는 표 항목 · 원문 확인 필요'].includes(explicit.type))return {...explicit,body:explicit.body+'\n관련 등록 사례가 있지만, 이 질문은 규정에서 직접 확인한 기준을 우선해 안내합니다. 사례로 다른 기준을 적용하려면 담당 부서의 확인이 필요합니다.'};
  }
  if(example)return example;
 }
 if(root.Knowledge){const resolved=root.Knowledge.resolve(team,question);if(resolved)return resolved;}
 if(details&&details.enabled)return contract(team,details);
 if(/부재|유고|대결/.test(q))return result('원칙은 차상급 이상 직위자 결재입니다','전결권자 유고 시 차상급 이상 직위자의 결재를 받습니다. 다만 휴가·출장 등으로 상당기간 부재한 경우, 기본품의에 근거한 지출·출장·휴가·협조 등 일상 업무 범위에서는 차하위자 또는 지정한 자가 대결할 수 있습니다.','제6조 제1항·제2항 · PDF 1쪽');
 if(/규정에없|규정없는|명시되지않/.test(q))return result('확인된 사례를 보완할 수 있어요','질문 화면의 “규정에 규정되어 있지 않은 사례” 목록에서 관련 사례와 적용 조건을 확인할 수 있습니다. 일치하는 사례가 없으면 전결권자를 임의로 정하지 않고 담당자 확인을 안내합니다.','등록 사례 목록과 적용 조건 확인','담당자 확인 필요');
 if(/계약|입찰|품의/.test(q))return result('계약 조건을 확인하면 전결권자를 안내할 수 있어요','질문 화면의 “계약 조건 입력”을 선택하고 계약 방식·처리 단계·부가세 제외 계약 총액을 입력해 주세요. 질문 문장에 있는 여러 금액이나 단계를 임의로 해석하지 않고 확인된 조건으로 계산합니다.',`별표 ${scope} · 9. 계약 관련 · PDF ${team.direct?'8':'12~13'}쪽`,'추가 확인 필요');
 if(root.Knowledge){const exact=root.Knowledge.matchEntry(question,team);if(exact)return exact;}
 if(root.Knowledge){const candidates=root.Knowledge.search(question,team);return {...result(candidates.length?'관련 규정 항목을 찾았습니다':'질문을 조금 더 구체적으로 알려주세요',candidates.length?'아래에서 질문과 일치하는 업무 항목을 확인해 주세요. 자동 추출한 표의 전결권 열은 참고 후보이며, 대상·금액·처리 단계·적용 조직이 맞는지 원문 확인이 필요합니다.':'업무명, 대상 직위, 처리 단계를 알려주세요. 검색 결과가 없다는 것만으로 규정에 없는 업무라고 판단하지 않습니다.',`2026.04.22 개정 공개 규정 전체 38쪽 검색 · 별표 ${scope} 공통사항 및 별표 Ⅲ 직무별 사항`,'관련 근거 검색'),candidates,references:root.Knowledge.searchText(question)};}
 return result('규정 검색 자료를 불러오지 못했습니다','페이지를 다시 열어 주세요.','규정 자료 연결 확인 필요','검색 오류');
 }
 const api={classify,answer,contract};if(typeof module!=='undefined')module.exports=api;else root.Rules=api;
})(typeof window!=='undefined'?window:globalThis);

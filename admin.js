'use strict';
const $ = id => document.getElementById(id);
let session = {authenticated:false};
let records = [];
let selected;
let dirty = false;
let working = false;
let publishAction = 'publish';
class FormError extends Error {}
function view(name) { for (const id of ['login','password','manage']) $(`${id}-view`).hidden = id !== name; $('session-actions').hidden = !session.authenticated; }
function textMessage(message='') { $('page-message').textContent=message; }
async function api(path, {method='GET',body}={}) {
 const response=await fetch(path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body?{'Content-Type':'application/json'}:{}),...(session.csrfToken?{'X-CSRF-Token':session.csrfToken}:{})},body:body?JSON.stringify(body):undefined});
 let data;try{data=await response.json();}catch{throw new Error('서버 응답을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.');}
 if(!response.ok){const error=new Error(data.message||data.error||'요청을 처리하지 못했습니다.');error.status=response.status;throw error;}
 return data;
}
async function task(action,errorId='editor-error') {
 if(working)return;working=true;$(errorId).textContent='';
 const buttons=[...document.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
 try { await action(); } catch(error) { if(!(error instanceof FormError)) $(errorId).textContent=error.status===409?'다른 수정 내용이 저장되어 있습니다. 목록을 새로 불러온 뒤 다시 확인해 주세요.':error.message; }
 finally {working=false;buttons.forEach(b=>b.disabled=false);}
}
async function refreshSession() {
 session=await api('/api/session');
 if(!session.authenticated){view('login');return false;}
 $('admin-name').textContent=session.username;
 if(session.mustChangePassword){showPassword(true);return false;}
 return true;
}
async function loadRecords(message='') {
 const data=await api('/api/admin/cases');records=data.cases||[];
 view('manage');renderList();textMessage(message);
}
function stats(){
 $('total-count').textContent=records.length;
 $('published-count').textContent=records.filter(r=>r.isPublished||r.state==='published').length;
 $('draft-count').textContent=records.filter(r=>r.state==='draft').length;
}
function renderList(){
 stats();$('case-items').replaceChildren();
 const q=$('search').value.trim().toLowerCase();
 const shown=records.filter(r=>(r.title+' '+(r.keywords||[]).join(' ')).toLowerCase().includes(q)).sort((a,b)=>b.number-a.number);
 $('empty-list').hidden=shown.length>0;
 for(const record of shown){
  const button=document.createElement('button');button.type='button';button.className='case-item'+(selected?.id===record.id?' active':'');
  const title=document.createElement('strong');title.textContent=`${record.number}. ${record.title}`;
  const status=document.createElement('small');status.textContent=record.isPublished?(record.state==='draft'?'공개 중 · 수정안 작성 중':'공개 중'):'작성 중';
  button.append(title,status);button.onclick=()=>{if(canLeave())fillForm(record);};$('case-items').append(button);
 }
}
function canLeave(){return !dirty||window.confirm('저장하지 않은 내용이 있습니다. 다른 사례로 이동할까요?');}
function closePublish(){$('publish-panel').hidden=true;$('publish-check').checked=false;$('publish-error').textContent='';}
function addReference(ref={}){
 const row=document.createElement('div');row.className='reference-row';
 const page=document.createElement('input');page.type='number';page.min='1';page.max='38';page.placeholder='PDF 쪽';page.setAttribute('aria-label','규정 PDF 쪽수');page.value=ref.page||'';
 const label=document.createElement('input');label.type='text';label.maxLength=300;label.placeholder='예: 별표 Ⅱ · 8. 기본방침의 결정';label.setAttribute('aria-label','규정 근거 항목');label.value=ref.label||'';
 const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label','이 근거 삭제');remove.onclick=()=>{row.remove();dirty=true;closePublish();};
 row.append(page,label,remove);$('references').append(row);
}
function fillForm(record){
 selected=record?structuredClone(record):undefined;
 $('case-form').reset();$('references').replaceChildren();closePublish();$('editor-error').textContent='';
 $('editor-heading').textContent=record?`사례 ${record.number} 수정`:'새 사례 작성';
 $('record-status').textContent=record?.isPublished?(record.state==='draft'?'공개 내용 유지 · 수정안 작성 중':'공개 중'):'작성 중';
 $('unpublish').hidden=!record?.isPublished;
 $('builtin-note').hidden=record?.kind!=='builtin';
 $('case-title').value=record?.title||'';$('case-question').value=record?.question||'';
 $('case-scope').value=record?.scope||'headquarters';$('case-keywords').value=(record?.keywords?.length?record.keywords:record?[record.title]:[]).join(', ');
 $('case-summary').value=record?.summary||'';$('case-conditions').value=(record?.conditions||[]).join('\n');$('case-answer').value=record?.answer||'';$('case-notes').value=(record?.notes||[]).join('\n');
 for(const ref of record?.regulationRefs||[])addReference(ref);
 $('reviewed').checked=record?.verification?.status==='reviewed';$('reviewer').value=record?.verification?.reviewer||'';$('review-date').value=record?.verification?.reviewedAt||'';reviewRequired();
 dirty=false;renderList();
}
function reviewRequired(){const checked=$('reviewed').checked;$('reviewer').required=checked;$('review-date').required=checked;}
function formRecord(){
 if(!$('case-form').reportValidity())throw new FormError();
 const lines=id=>$(id).value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean);
 const keywords=[...new Set($('case-keywords').value.split(/[,，\n]/).map(s=>s.trim()).filter(Boolean))];
 if(!keywords.length||keywords.some(k=>k.length<2))throw new Error('검색어는 각각 두 글자 이상의 구체적인 업무명으로 입력해 주세요.');
 const refs=[];
 for(const row of $('references').children){const [page,label]=row.querySelectorAll('input');if(!page.value&&!label.value.trim())continue;if(!page.value||!label.value.trim())throw new Error('규정 근거의 쪽수와 항목을 함께 입력해 주세요.');refs.push({page:Number(page.value),label:label.value.trim()});}
 return {title:$('case-title').value.trim(),question:$('case-question').value.trim(),keywords,scope:$('case-scope').value,mode:'general',summary:$('case-summary').value.trim(),conditions:lines('case-conditions'),answer:$('case-answer').value.trim(),notes:lines('case-notes'),regulationRefs:refs,verification:$('reviewed').checked?{status:'reviewed',reviewer:$('reviewer').value.trim(),reviewedAt:$('review-date').value}:{status:'unrecorded',reviewer:null,reviewedAt:null}};
}
async function saveCurrent(){
 const payload=formRecord();const existing=selected?.id;
 const data=await api(existing?`/api/admin/cases/${encodeURIComponent(existing)}`:'/api/admin/cases',{method:existing?'PUT':'POST',body:{...payload,...(existing?{revision:selected.revision}:{})}});
 const saved=data.case;
 if(!saved)throw new Error('저장 결과를 확인하지 못했습니다.');
 await loadRecords('임시 저장했습니다. 공개 중인 내용은 검토 후 공개할 때 바뀝니다.');fillForm(records.find(r=>r.id===saved.id)||saved);return selected;
}
$('login-form').onsubmit=e=>{e.preventDefault();task(async()=>{await api('/api/login',{method:'POST',body:{username:$('username').value.trim(),password:$('password').value}});$('password').value='';if(await refreshSession()){await loadRecords();fillForm();}},'login-error');};
function showPassword(required=false){view('password');$('password-form').reset();$('password-error').textContent='';$('cancel-password').hidden=required;$('password-description').textContent=required?'첫 로그인입니다. 새 비밀번호로 변경한 뒤 계속할 수 있습니다.':'계정 보호를 위해 12자 이상의 비밀번호를 사용해 주세요.';}
$('change-password').onclick=()=>{if(canLeave())showPassword(false);};
$('cancel-password').onclick=()=>view('manage');
$('password-form').onsubmit=e=>{e.preventDefault();task(async()=>{if($('new-password').value!==$('confirm-password').value)throw new Error('새 비밀번호가 일치하지 않습니다.');await api('/api/password',{method:'POST',body:{currentPassword:$('old-password').value,newPassword:$('new-password').value}});$('password-form').reset();if(await refreshSession()){await loadRecords('비밀번호를 변경했습니다.');fillForm();}},'password-error');};
$('logout').onclick=()=>{if(!canLeave())return;task(async()=>{await api('/api/logout',{method:'POST',body:{}});session={authenticated:false};records=[];selected=undefined;dirty=false;$('case-form').reset();$('case-items').replaceChildren();$('login-form').reset();$('username').value='admin';view('login');},'page-message');};
$('new-case').onclick=()=>{if(canLeave()){fillForm();$('case-title').focus();}};
$('search').oninput=renderList;
$('add-reference').onclick=()=>{addReference();dirty=true;closePublish();};
$('reviewed').onchange=reviewRequired;
$('case-form').oninput=()=>{dirty=true;closePublish();};
$('case-form').onchange=()=>{dirty=true;closePublish();};
$('case-form').onsubmit=e=>{e.preventDefault();task(saveCurrent);};
$('prepare-publish').onclick=()=>task(async()=>{if(!selected||dirty)await saveCurrent();publishAction='publish';$('publish-heading').textContent='이 사례를 공개할까요?';$('publish-preview').textContent=`${selected.title}\n\n${selected.conditions.join('\n')}\n\n${selected.answer}`;$('publish-check-label').hidden=false;$('confirm-publish').textContent='일반 화면에 공개';$('publish-panel').hidden=false;$('publish-check').focus();});
$('unpublish').onclick=()=>{if(!selected)return;publishAction='unpublish';$('publish-heading').textContent='이 사례의 공개를 해제할까요?';$('publish-preview').textContent=`${selected.title}\n공개를 해제하면 일반 화면의 답변에서 제외됩니다. 사례는 관리자 목록에 남습니다.`;$('publish-check-label').hidden=true;$('confirm-publish').textContent='공개 해제하기';$('publish-panel').hidden=false;};
$('cancel-publish').onclick=closePublish;
$('confirm-publish').onclick=()=>task(async()=>{if(publishAction==='publish'&&!$('publish-check').checked)throw new Error('답변과 적용 조건을 확인한 뒤 체크해 주세요.');const data=await api(`/api/admin/cases/${encodeURIComponent(selected.id)}/${publishAction}`,{method:'POST',body:{revision:selected.revision,...(publishAction==='publish'?{reviewConfirmed:true}:{})}});await loadRecords(publishAction==='publish'?'공개했습니다. 일반 이용 화면을 새로고침하면 반영됩니다.':'공개를 해제했습니다.');fillForm(records.find(r=>r.id===data.case.id)||data.case);},'publish-error');
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
(async()=>{try{if(await refreshSession()){await loadRecords();fillForm();}}catch{$('login-error').textContent='관리 서버에 연결하지 못했습니다. 서버 실행 상태를 확인해 주세요.';view('login');}})();

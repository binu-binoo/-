function reviewText(record) { const v = record.verification; return v?.status === 'reviewed' && v.reviewer && v.reviewedAt ? `확인한 부서·역할: ${v.reviewer} · 확인일: ${v.reviewedAt}` : '확인한 부서·역할 및 확인일: 자료에 미기재'; }
const $ = id => document.getElementById(id);
let selected;
let approvalMode;
let activeCaseId;
let caseConditions = {};
const screens = ['mode', 'team', 'question', 'answer'];
const documents = {
  regulation: { title: '위임전결규정', pages: RegulationData.pages, pdf: () => globalThis.RegulationPdfUrl || 'data/regulation.pdf', notice: '2026.04.22 개정 공개본입니다.' }
};
if (globalThis.ManualData?.pages?.length) {
  documents.manual = { title: ManualData.title, pages: ManualData.pages, notice: '사용자 외부 공유 허용 · 이름·연락처 제외. 이미지 설명은 재구성했습니다. 원문 PDF는 첨부하신 파일에서 확인해 주세요.' };
  const option = document.createElement('option');
  option.value = 'manual';
  option.textContent = '대결권 활용 매뉴얼 · 이름·연락처 제외';
  $('document-kind').append(option);
}
if (globalThis.CaseData?.cases?.length) {
  documents.cases = { title: Cases.label, unit: 'case', pages: CaseData.cases.map(record => ({page: record.number, text: `${record.title}\n\n${record.summary}\n\n적용 조건` + '\n' + record.conditions.map(c => '· ' + c).join('\n') + '\n\n안내 내용\n' + record.answer + '\n\n주의사항\n' + record.notes.join('\n') + '\n\n' + reviewText(record)})), notice: '첨부한 사례를 구조화한 자료입니다. 규정 원문과 구분하며 사례의 조건이 맞는지 확인해 주세요.' };
  const option = document.createElement('option'); option.value = 'cases'; option.textContent = Cases.label; $('document-kind').append(option);
  $('case-count').textContent = `(${CaseData.cases.length}건)`; $('case-footer').textContent = `사례 ${CaseData.cases.length}건 · 조건별 안내`;
  for (const record of CaseData.cases) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${record.number}. ${record.title}`;
    button.onclick = () => { activeCaseId = record.id; caseConditions = {}; $('question').value = record.title; $('question').setCustomValidity(''); $('question').focus(); };
    $('case-list').append(button);
  }
} else $('case-library').hidden = true;
function show(screen) {
  screens.forEach((name, i) => {
    $(`${name}-screen`).hidden = name !== screen;
    $(`step${i + 1}`).classList.toggle('active', name === screen);
    if (name === screen) $(`step${i + 1}`).setAttribute('aria-current', 'step');
    else $(`step${i + 1}`).removeAttribute('aria-current');
  });
  const target = screen === 'mode' ? document.querySelector('[name="approval-mode"]') : $({ team: 'team', question: 'question', answer: 'answer-title' }[screen]);
  if (screen === 'answer') target.setAttribute('tabindex', '-1');
  target.focus();
}
function showPage(number, kind = $('document-kind').value) {
  const doc = documents[kind] || documents.regulation;
  $('document-kind').value = documents[kind] ? kind : 'regulation';
  $('document-page').replaceChildren();
  for (const page of doc.pages) {
    const option = document.createElement('option');
    option.value = page.page;
    option.textContent = doc.unit === 'case' ? `사례 ${page.page}` : `PDF ${page.page}쪽`;
    $('document-page').append(option);
  }
  const page = doc.pages.find(p => p.page === Number(number)) || doc.pages[0];
  $('document-page').value = String(page.page);
  $('document-text').textContent = page.text;
  $('document-notice').textContent = doc.notice;
  $('document-summary').textContent = `${doc.title} · ${doc.pages.length}${doc.unit === 'case' ? '건' : '쪽'}`;
  $('original-pdf').hidden = !doc.pdf;
  if (doc.pdf) $('original-pdf').href = `${doc.pdf()}#page=${page.page}`;
  else $('original-pdf').removeAttribute('href');
}
function openSource(kind, page) {
  showPage(page, kind);
  document.querySelector('.document-browser').open = true;
  $('document-text').focus();
}
$('document-kind').onchange = () => showPage(1);
$('document-page').onchange = () => showPage(Number($('document-page').value));
showPage(1, 'regulation');
function clearAnswer() {
  for (const id of ['asked', 'answer-type', 'answer-title', 'answer-body', 'answer-source']) $(id).textContent = '';
  $('candidates').replaceChildren();
  $('case-panel').replaceChildren(); $('case-panel').hidden = true;
  document.querySelector('.document-browser').open = false;
  showPage(approvalMode === 'deputy' && documents.manual ? 2 : 1, approvalMode === 'deputy' && documents.manual ? 'manual' : 'regulation');
}
function restartMode() {
  selected = undefined;
  approvalMode = undefined; activeCaseId = undefined; caseConditions = {};
  $('mode-form').reset();
  $('team-form').reset();
  $('question-form').reset();
  $('team-error').textContent = '';
  $('team-name').textContent = '';
  $('group').textContent = '';
  $('contract-details').open = false;
  $('deputy-details').open = false; $('case-library').open = false;
  $('question').setCustomValidity('');
  clearAnswer();
  show('mode');
}
$('mode-form').onsubmit = e => {
  e.preventDefault();
  const checked = document.querySelector('[name="approval-mode"]:checked');
  if (!checked) return;
  approvalMode = checked.value;
  const deputy = approvalMode === 'deputy';
  const label = deputy ? '대결' : '일반 결재';
  $('team-mode').textContent = label;
  $('mode-name').textContent = label;
  $('question-heading').textContent = deputy ? '어떤 대결 상황이 궁금한가요?' : '어떤 내용이 궁금한가요?';
  $('question-description').textContent = deputy ? '누가 부재 중인지, 어떤 업무를 대신 결재하려는지 알려주세요.' : '어떤 업무인지, 금액과 진행 단계를 함께 알려주세요.';
  $('question').placeholder = deputy ? '예: 팀장님이 휴가 중인데, 승인된 기본품의에 근거한 지출을 대결할 수 있나요?' : '예: 본부 소속 실장님 휴가는 누구 전결인가요?';
  $('contract-details').hidden = deputy;
  $('case-library').hidden = deputy || !globalThis.CaseData?.cases?.length;
  $('deputy-details').hidden = !deputy;
  $('deputy-details').open = deputy;
  $('footer-source').textContent = deputy ? '대결 매뉴얼 / 위임전결규정' : '공개 규정 38쪽 · 전체 근거 검색';
  const examples = deputy ? ['기본품의도 대결할 수 있나요?', '대결권자 지정을 구두로 해도 되나요?', '대결권자에게 결재는 어떻게 올리나요?', '팀장급과 실장급 이상은 위임 방법이 다른가요?'] : ['실장님이 휴가를 올리려고 하면 누구 전결인가요?', '팀원 해외출장은 누구 전결인가요?', '규정에 없는 업무는 어떻게 하나요?'];
  $('examples').replaceChildren();
  for (const text of examples) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = text;
    button.onclick = () => { $('question').value = text; $('question').focus(); };
    $('examples').append(button);
  }
  clearAnswer();
  show('team');
};
for (const id of ['mode-from-team', 'mode-from-question', 'mode-from-answer']) $(id).onclick = restartMode;
$('teams').onclick = e => { if (e.target.tagName === 'BUTTON') { $('team').value = e.target.textContent; $('team').focus(); } };
$('team-form').onsubmit = e => {
  e.preventDefault();
  try {
    if (!approvalMode) { restartMode(); return; }
    selected = Rules.classify($('team').value);
    $('team-error').textContent = '';
    $('team-name').textContent = selected.team;
    $('group').textContent = selected.direct ? '사장직속 · 별표 Ⅰ' : '본부 소속 · 별표 Ⅱ';
    $('question-form').reset(); $('question').setCustomValidity(''); activeCaseId = undefined; caseConditions = {};
    $('contract-details').open = false;
    $('deputy-details').open = approvalMode === 'deputy';
    clearAnswer(); show('question');
  } catch (err) { $('team-error').textContent = err.message; }
};
$('change-team').onclick = $('restart').onclick = () => { selected = undefined; clearAnswer(); show('team'); };
$('ask-again').onclick = () => { clearAnswer(); show('question'); };
$('question').oninput = () => { $('question').setCustomValidity(''); activeCaseId = undefined; caseConditions = {}; };
function renderAnswer(a, question) {
  $('asked').textContent = `${approvalMode === 'deputy' ? '대결' : '일반 결재'} · ${selected.team} · ${question}`;
  $('answer-type').textContent = a.type; $('answer-title').textContent = a.title;
  $('answer-body').textContent = a.body; $('answer-source').textContent = a.source;
  for (const citation of a.citations || []) {
    if (!documents[citation.document]) continue;
    const button = document.createElement('button'); button.className = 'source-button'; button.type = 'button';
    button.textContent = `${documents[citation.document].title} ${documents[citation.document].unit === 'case' ? '사례 ' + citation.page : citation.page + '쪽'} 확인`;
    button.onclick = () => openSource(citation.document, citation.page);
    $('answer-source').append(button);
  }
  renderCandidates(a.candidates || [], a.references || []);
  renderCaseAnswer(a, question);
  show('answer');
}
$('question-form').onsubmit = e => {
  e.preventDefault(); const question = $('question').value.trim();
  if (!question || !selected || !approvalMode) {
    $('question').setCustomValidity('궁금한 내용을 입력해 주세요.'); $('question').reportValidity(); return;
  }
  caseConditions = {};
  const details = { enabled: !$('contract-details').hidden && $('contract-details').open, method: $('method').value, stage: $('stage').value, amount: $('amount').value, standalone: $('standalone').value, vat: $('vat').checked, eligible: $('eligible').checked, approved: $('approved').checked };
  const conditions = { absent: $('absence').value, routine: $('routine').value, approved: $('prior-approval').value, delegation: $('delegation').value };
  renderAnswer(Rules.answer(selected, question, details, { mode: approvalMode, conditions, caseId: activeCaseId, caseConditions }), question);
};
function renderCandidates(candidates, references) {
  $('candidates').replaceChildren();
  if (approvalMode === 'deputy') return;
  for (const entry of candidates) {
    const article = document.createElement('article'); article.className = 'candidate';
    const badge = document.createElement('span'); badge.className = 'tag'; badge.textContent = `PDF ${entry.page}쪽 · 별표 ${entry.scope === 'I' ? 'Ⅰ' : entry.scope === 'II' ? 'Ⅱ' : 'Ⅲ'} · 원문 확인 필요`;
    const title = document.createElement('h3'); title.textContent = entry.text || '표 항목';
    const role = document.createElement('p'); role.textContent = `표에서 추출한 전결권 후보: ${entry.authority}`;
    const context = document.createElement('pre'); context.textContent = entry.context;
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '주변 항목 함께 보기'; details.append(summary, context);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = '해당 쪽 원문 확인'; button.onclick = () => openSource('regulation', entry.page);
    const choose = document.createElement('button'); choose.type = 'button'; choose.className = 'primary'; choose.textContent = '이 항목 기준으로 답변 보기';
    choose.onclick = () => {
      $('answer-type').textContent = '선택한 표 항목 · 원문 확인 필요'; $('answer-title').textContent = entry.authority + ' 전결로 표시되어 있습니다';
      $('answer-body').textContent = '선택한 항목: ' + entry.text + '\n표에서 자동 추출한 전결권 표시입니다. 주변 조건과 소속 조직이 질문에 맞는지 원문을 확인해 주세요.';
      $('answer-source').textContent = `별표 ${entry.scope === 'I' ? 'Ⅰ' : entry.scope === 'II' ? 'Ⅱ' : 'Ⅲ'} · PDF ${entry.page}쪽`;
      openSource('regulation', entry.page); $('answer-title').focus();
    };
    article.append(badge, title, role, details, choose, button); $('candidates').append(article);
  }
  for (const ref of references) {
    const details = document.createElement('details'); details.className = 'candidate'; const summary = document.createElement('summary'); summary.textContent = `본문 검색 결과 · PDF ${ref.page}쪽`;
    const text = document.createElement('pre'); text.textContent = ref.text; details.append(summary, text); $('candidates').append(details);
  }
}

function renderCaseAnswer(answer, question) {
  const panel = $('case-panel'); panel.replaceChildren(); panel.hidden = !answer.caseRecord && !answer.caseMatches;
  if (panel.hidden) return;
  for (const record of answer.caseMatches || []) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary'; button.textContent = record.title;
    button.onclick = () => { activeCaseId = record.id; caseConditions = {}; renderAnswer(Rules.answer(selected, question, undefined, { mode: approvalMode, caseId: activeCaseId, caseConditions }), question); };
    panel.append(button);
  }
  if (!answer.caseRecord) return;
  activeCaseId = answer.caseId;
  const title = document.createElement('h3'); title.textContent = `사례 ${answer.caseRecord.number}. ${answer.caseRecord.title}`;
  const info = document.createElement('p'); info.className = 'privacy'; info.textContent = reviewText(answer.caseRecord) + ' · 아래 적용 조건과 실제 업무가 일치하는지 확인해 주세요.';
  const list = document.createElement('ul');
  for (const text of answer.caseRecord.conditions) { const li = document.createElement('li'); li.textContent = text; list.append(li); }
  panel.append(title, info, list);
  if (!answer.followups?.length) return;
  const form = document.createElement('form'); form.id = 'case-followup';
  for (const item of answer.followups) {
    const id = 'case-' + item.key; const label = document.createElement('label'); label.htmlFor = id; label.textContent = item.label;
    const input = document.createElement(item.kind === 'money' ? 'input' : 'select'); input.id = id; input.name = item.key; input.required = true;
    if (item.kind === 'money') { input.type = 'text'; input.inputMode = 'numeric'; input.pattern = '[0-9,]+'; input.placeholder = '원 단위로 입력 · 예: 200000000'; input.maxLength = 20; }
    else for (const choice of item.options) { const option = document.createElement('option'); option.value = choice.value === 'unknown' ? '' : choice.value; option.textContent = choice.label; input.append(option); }
    form.append(label, input);
  }
  const submit = document.createElement('button'); submit.type = 'submit'; submit.className = 'primary'; submit.textContent = '조건을 반영해 답변 확인'; form.append(submit);
  form.onsubmit = event => { event.preventDefault(); for (const [key, value] of new FormData(form)) caseConditions[key] = value; renderAnswer(Rules.answer(selected, question, undefined, { mode: approvalMode, caseId: activeCaseId, caseConditions }), question); };
  panel.append(form);
}

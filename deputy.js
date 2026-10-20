(function (root) {
  'use strict';

  const regulation = {document: 'regulation', page: 1};
  const manual = page => ({document: 'manual', page});
  const labels = {regulation: '위임전결규정', manual: '대결권 활용 매뉴얼(2026)'};

  function result(title, body, citations, type = '대결 기준 안내') {
    const unique = citations.filter((c, i, all) => all.findIndex(x => x.document === c.document && x.page === c.page) === i);
    return {
      title, body,
      source: unique.map(c => `${labels[c.document]} · PDF ${c.page}쪽`).join(' / '),
      type, citations: unique
    };
  }

  function procedureText(q) {
    const upper = /실장|센터장|본부장/.test(q);
    const lower = /팀장/.test(q);
    const parts = [];
    if (!upper || lower) parts.push('팀장급 전결권자는 간이서식 “대결권위임”을 직접 작성·결재합니다. KTO-NET > 결재 > 기안작성하기 > 간이서식(내부) > 대결권위임 경로를 사용합니다. 제목은 “○○○(직위) 부재기간 대결권 위임” 형식으로 작성합니다.');
    if (upper || !lower) parts.push('실장급 이상(실장·센터장·본부장)은 매뉴얼에 기재된 전자문서 시스템의 기안 제한으로, 사내메신저·쪽지 등 내부통신망을 이용해 위임하도록 안내되어 있습니다. 현재 시스템의 변경 여부는 담당자에게 확인해 주세요.');
    parts.push('공통으로 대결권자·위임기간·위임사유를 명시해야 합니다. FAQ의 “불가피한 경우 외 위임 기안 권고”는 위 직급별 시스템 제한과 함께 적용해야 하며, 구두 위임만으로 대신할 수 없습니다.');
    return parts.join('\n');
  }

  function answer(team, question, conditions = {}) {
    const q = String(question || '').replace(/\s/g, '');
    const name = String(team && team.team || '').replace(/\s/g, '');
    if (name === '감사팀' || name === '감사실') {
      return result('감사 관련 별도 기준을 먼저 확인해야 합니다',
        '위임전결규정 제7조 제2항은 감사실에 관한 사항을 별도로 정하도록 합니다. 감사팀에 적용되는 별도 기준과 대결권 위임 내용을 담당자에게 확인해 주세요. 일반 전결표의 직위를 대결권자로 단정하지 않습니다.',
        [regulation], '별도 기준 확인 필요');
    }

    const input = conditions && typeof conditions === 'object' ? conditions : {};
    const checked = (key, valid) => valid.includes(input[key]) ? input[key] : 'unknown';
    const absent = checked('absent', ['yes', 'no']);
    const routine = checked('routine', ['yes', 'no']);
    let approved = checked('approved', ['yes', 'no', 'na']);
    let delegation = checked('delegation', ['documented', 'oral', 'none']);
    const expense = /지출|지급|정산|전도금|가지급금|여비|비용집행/.test(q);
    // Explicitly negative facts in the question override an inconsistent positive selector.
    if (/승인(?:을)?받지않|승인(?:을)?안받|미승인|승인없|승인되지않|기본품의없|기본품의없이/.test(q)) approved = 'no';
    if (/구두로만|구두로위임|구두위임만|말로만|기록없이|서면없이/.test(q)) delegation = 'oral';
    if (/위임(?:을)?받지않|위임(?:을)?안받|지정(?:을)?받지않|위임기록없|위임문서없/.test(q)) delegation = 'none';
    const originalApproval = /기본품의(?:서)?(?:를|는|도)?(?:자체|신규|신설|수립|작성|변경|결정|기안|올리|결재)|기본품의(?:서)?(?:를|는|도)?대결|새로운?의사결정|신규의사결정|의사결정이?필요|의사결정을?요하는/.test(q);

    if (originalApproval || routine === 'no') {
      return result('기본품의·의사결정이 필요한 건은 대결할 수 없습니다',
        '기본품의 자체나 새로운 의사결정이 필요한 업무는 대결 범위에 포함되지 않습니다. 전결권자 유고 시 차상급 이상 직위자의 결재를 받아야 합니다. 이미 승인된 기본품의에 근거한 일상적인 지출 등과 구분해 주세요.',
        [manual(6), regulation], '대결 불가 · 차상급 결재');
    }

    if (expense && approved === 'no') {
      return result('기본품의 승인이 없는 지출은 대결 가능으로 안내할 수 없습니다',
        '대결 범위의 지출은 기본품의에 근거한 일상 업무여야 합니다. 기본품의 자체나 의사결정이 필요한 건은 대결할 수 없으므로, 전결권자 유고 시 차상급 이상 직위자의 결재를 받아야 합니다.',
        [regulation, manual(6)], '대결 불가 · 차상급 결재');
    }
    if (delegation === 'oral' || delegation === 'none') {
      return result('대결권자와 위임기간·사유의 기록을 먼저 확인해야 합니다',
        (delegation === 'oral' ? '구두 위임만으로는 충분하지 않습니다. ' : '대결권자를 지정한 근거가 확인되지 않았습니다. ') +
        procedureText(q) + '\n기록과 대결 가능 업무 범위를 확인하기 전에는 특정인을 대결권자로 확정하지 않습니다.',
        [manual(2), manual(3), manual(7)], '위임 기록 확인 필요');
    }

    if (/위임방법|위임절차|위임기안|기안작성|간이서식|대결권위임(?:은|을|는|이|절차|방법)|(?:팀장급|실장급|센터장급|본부장급).*위임|위임.*(?:어떻게|팀장급|실장급|센터장급|본부장급)|어떻게.*위임/.test(q)) {
      const formApplicable = !/실장|센터장|본부장/.test(q) || /팀장/.test(q);
      return result('직급에 맞는 방법으로 대결권 위임을 기록해야 합니다',
        procedureText(q) + (formApplicable ? '\n팀장급의 위임 기안을 작성하는 경우 결재선의 본인을 “전결”로 설정하고, 본인의 소속·직급·성명과 대결권자·위임기간·위임사유를 입력합니다. 상신하면 바로 결재 완료되며 완료 후에는 수정할 수 없으므로 상신 전 내용을 확인해야 합니다. 완료 문서는 부서 기록물등록대장에서 확인합니다.' : ''),
        formApplicable ? [manual(3), manual(4), manual(5), manual(7)] : [manual(3), manual(7)], '직급별 위임 방법 안내');
    }

    // These questions ask for procedures, not permission for a particular task.
    if (/위임기간|대결기간|며칠|몇일|최대기간|기간제한|기간은/.test(q)) {
      return result('실제로 통보·기안한 위임기간을 확인해야 합니다',
        '대결권 위임 시 대결권자·위임기간·위임사유를 메신저·쪽지 또는 기안으로 명시해야 합니다. 이 매뉴얼 근거만으로 최대 며칠처럼 일수를 임의로 정하지 않습니다. 실제 부재 기간과 위임 내용을 확인해 주세요.',
        [manual(7)], '위임기간 확인');
    }
    if (/결재선|결재경로|경로설정|전결표시|대결표시|전결권자결재없이|전결권자도결재|완료처리|대결권자에게결재|대결권자.*결재.*올리/.test(q)) {
      return result('원 전결권자는 “전결”, 이전 단계 대결권자는 “대결”로 설정합니다',
        '결재경로의 마지막 전결권자를 “전결”, 그 이전 단계의 지정된 대결권자를 “대결”로 설정합니다. 대결권자가 결재하면 원 전결권자의 별도 결재 없이 완료됩니다. 이 경로 설정 자체가 대결권 위임이나 대결 가능 업무 확인을 대신하지는 않습니다.',
        [manual(7)], '대결 결재경로 안내');
    }
    if (/사후보고|사후에보고|나중에보고/.test(q)) {
      return result('중요한 내용은 전결권자에게 사후 보고해야 합니다',
        '매뉴얼은 대결로 처리한 중요한 내용의 사후 보고를 안내합니다. 사후 보고를 한다는 이유로 기본품의 자체나 새 의사결정이 필요한 건을 대결할 수 있는 것은 아닙니다.',
        [manual(2), manual(6)], '사후 보고 안내');
    }
    if (/누구를지정|누구에게위임|선정기준|지정기준|대결권자선정|대결권자지정방법/.test(q)) {
      return result('전결권자가 적정한 대결권자를 지정해야 합니다',
        '전결권자가 바로 아래 직원 중 직제상 우선순위, 직무 비중, 능력, 경력 및 책임 등을 고려하여 지정합니다. 특정 직위가 자동으로 대결권자가 되는 것은 아닙니다. 실제 지정 여부와 위임기간·사유는 기안 또는 내부통신망 통보로 확인해 주세요.',
        [manual(2), manual(7), regulation], '대결권자 지정 기준');
    }
    if (/구두|말로만|메신저|쪽지|위임기안|서면|통보방법/.test(q) && delegation === 'unknown') {
      return result('구두 위임만으로 처리하지 말고 기록을 남겨야 합니다',
        procedureText(q) + '\n기록을 남겨도 부재 요건과 업무 범위가 맞는지는 별도로 확인해야 합니다.',
        [manual(2), manual(3), manual(7)], '위임 기록 안내');
    }

    if (absent === 'no') {
      return result('확인된 부재 요건 없이 대결권자를 정할 수 없습니다',
        '휴가·출장 또는 부득이한 사유로 상당기간 부재하는지 확인되지 않은 상태입니다. 일반 결재와 대결을 구분해 주세요. 전결권자가 유고로 직접 결재할 수 없다면, 제6조 제1항에 따라 차상급 이상 직위자의 결재를 받아야 합니다.',
        [regulation, manual(2)], '대결 요건 미충족');
    }

    const missing = [];
    if (absent !== 'yes') missing.push('① 부재 요건: 휴가·출장 또는 부득이한 사유로 전결권자가 상당기간 부재하는지');
    if (routine !== 'yes' || (expense && approved !== 'yes')) missing.push('② 업무 범위: 기본품의 자체나 새 의사결정이 아닌 일상 업무인지' + (expense ? ', 지출이라면 승인된 기본품의에 근거하는지' : ''));
    if (delegation !== 'documented') missing.push('③ 위임 기록: 대결권자·위임기간·위임사유가 메신저·쪽지 또는 기안으로 명시되어 있는지');
    if (missing.length) {
      return result('대결 가능 여부를 확인하려면 다음 조건이 필요합니다',
        missing.join('\n') + '\n일반 전결권자와 실제 대결권자는 다릅니다. 위 조건이 확인되기 전에는 팀장·실장 등 특정 직위를 대결권자로 정하지 않습니다.',
        [regulation, manual(2), manual(6), manual(7)], '추가 확인 필요');
    }

    return result('입력하신 조건에서는 지정된 대결권자가 일상 업무를 처리할 수 있습니다',
      '상당기간 부재 요건, 일상 업무 범위' + (expense ? ', 승인된 기본품의' : '') + ' 및 위임 기록이 확인된 것으로 입력되었습니다.\n실제 처리자는 전결권자가 지정한 대결권자이며, 직위만으로 자동 지정되지 않습니다. 위임 기록의 대상자·기간·사유와 해당 업무 범위를 확인해 주세요. 중요한 내용은 사후 보고해야 합니다.\n기본품의 자체나 새로운 의사결정이 필요한 건은 이 안내에 포함되지 않습니다.',
      [regulation, manual(2), manual(6), manual(7)], '입력 조건에 따른 대결 안내');
  }

  const api = {answer};
  root.Deputy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);

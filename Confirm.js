const XLSX = require('xlsx');
const path = require('path');

// 파일 경로
const CLICK_DB_PATH = path.join(__dirname, 'db', 'clickDB.xlsx');
const CONFIRM_SCORE_PATH = path.join(__dirname, 'db', 'ConfirmScoreDB.xlsx');

// ✅ clickDB 읽고 참여자 존재 여부 확인
function hasUsers() {
  try {
    const wb = XLSX.readFile(CLICK_DB_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // 데이터가 없거나 모든 행이 빈 경우
    if (!data || data.length === 0) return false;

    // A열/B열 모두 비어 있는 경우 확인
    const hasAny = data.some(row =>
      (row[0] && row.toString().trim()) ||
      (row && row.toString().trim())
    );
    return hasAny;
  } catch (err) {
    console.error('Error reading clickDB.xlsx:', err);
    return false;
  }
}

// 검증자 선정 함수
function selectVerifiers() {
  if (!hasUsers()) {
    console.log('⚠️ clickDB.xlsx에 사용자가 없습니다. 검증자를 선정할 수 없습니다.');
    return [];
  }

  try {
    const wb = XLSX.readFile(CONFIRM_SCORE_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });

    // 첫 행은 헤더이므로 제외
    const rows = data.slice(1);

    // 멤버 객체 생성
    const members = rows.map(row => ({
      id: row ? row.toString().trim() : '',
      score: row ? parseFloat(row) : 0
    })).filter(m => m.id); // id가 없는 경우 제외

    // 멤버 수
    const n = members.length;

    // 점수 내림차순 > id 오름차순 정렬
    members.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.id.localeCompare(b.id);
    });

    // 검증자 수 결정
    let verifierCount = 0;
    if (n < 4) verifierCount = n;
    else if (n <= 10) verifierCount = 3;
    else if (n <= 99) verifierCount = 5;
    else verifierCount = 10;

    // 조건(0.5 이상)에 맞는 후보만 선정
    const candidates = members.filter(m => m.score >= 0.5);
    const verifiers = candidates.slice(0, verifierCount);

    console.log('=== 검증자 선정 결과 ===');
    if (verifiers.length === 0) {
      console.log('⚠️ 조건(0.5 이상)에 맞는 검증자가 없습니다.');
    } else {
      verifiers.forEach((v, idx) => {
        console.log(`${idx + 1}. ${v.id} (점수: ${v.score})`);
      });
    }

    return verifiers;
  } catch (err) {
    console.error('Error reading ConfirmScoreDB.xlsx:', err);
    return [];
  }
}

const verifiersData = selectVerifiers();

// 모듈 export는 객체 형태로 미리 계산된 데이터와 함수 동시에 가능
module.exports = {
  verifiersData,
  selectVerifiers
};
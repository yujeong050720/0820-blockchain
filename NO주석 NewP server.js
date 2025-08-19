//server.js
const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const path = require('path');

// DB 모듈 함수 불러오기 (엑셀 파일 I/O 모듈)
const { calcConfirmScores } = require('./ConfirmScore');    // 인증점수 계산 및 저장
const { selectVerifiers } = require('./Confirm');            // 인증점수 기반 검증자 선정
const { processClick, recordClick, loadClicks } = require('./Click');  // 클릭 기록 처리

const app = express(); //콜백함수 모음(미들웨어)
const server = http.createServer(app); //누군가 들어오는 요청을 받아서 처리하는 역할, 포트를 여는 역할
const io = socketio(server);

app.use(express.json());


app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/approveUser', (req, res) => {
  const { candidate, nickname, approvers, link } = req.body;
  
  if (!candidate || !nickname || !Array.isArray(approvers) || !link) {
    return res.status(400).json({ error: '잘못된 요청 데이터' });
  }

  processClick(candidate, nickname, 'profileLinkPlaceholder'); // 예시, 실제 필드 맞게 조정 필요

  approvers.forEach(validator => {
    recordClick(validator, candidate, link);
  });

  console.log(`사용자 ${candidate} 승인 및 클릭 기록 저장 완료`);

  //{ status: 'success' } 객체를 JSON으로 변환해서 클라이언트에 전달
  res.json({ status: 'success' });
});

const pendingVerifications = {}; // 후보자별 투표 상태 저장
let validators = [];

const userSockets = new Map();  // 사용자(지갑주소) -> 소켓ID

io.on('connection', (socket) => {
  console.log(`클라이언트 연결됨: ${socket.id}`);

  // 사용자 지갑주소와 닉네임 등록, 기존 사용자인지 확인
  socket.on('registerUser', async ({ walletAddr, nickname }) => {
    const normalizedWallet = walletAddr.toLowerCase();

    const isExistingUser = await checkUserExistsInNameDB(normalizedWallet, nickname);

    if (isExistingUser) { //isExistingUser가 true라면 = 기존에 nameDB.xlsx에 등록된 사용자
      userSockets.set(normalizedWallet, socket.id);

      console.log(`기존 사용자 등록: ${walletAddr} (${nickname}) -> ${socket.id}`);

      socket.emit('existingUserConfirmed', { walletAddr: normalizedWallet, nickname });
      return;
    }

    userSockets.set(normalizedWallet, socket.id);
    console.log(`신규 사용자 등록: ${walletAddr} (${nickname}) -> ${socket.id}`);

  });
  socket.on('disconnect', () => {
    for (const [wallet, id] of userSockets.entries()) {
      if (id === socket.id) {
        userSockets.delete(wallet);
        console.log(`사용자 연결 해제: ${wallet} -> ${socket.id}`);
        break;
      }
    }
  });
});

io.on('connection', (socket) => {

  socket.on('requestEntry', async ({ wallet, nickname }) => {
    const candidate = wallet.toLowerCase();
    if (pendingVerifications[candidate]) return; // 중복 요청 방지

    try {
      await calcConfirmScores();

      // 인증점수 기반 검증자 선발
      validators = selectVerifiers();

      pendingVerifications[candidate] = {
        validators: validators.map(v => v.id), //검증자들의 ID 배열을 저장
        votes: {}, //찬반 투표 결과를 저장할 빈 객체. { validatorId: true/false } 형태로 기록
        nickname, //신규 사용자의 닉네임을 저장, 투표 진행시 전달, 결과 판단
        link: '', //신규 사용자 프로필 링크 등 추가 정보를 저장할 공간
      };

      for (const vAddr of pendingVerifications[candidate].validators) { //검증자들의 지갑 주소 목록 순회
        const vSocketId = validatorSockets.get(vAddr.toLowerCase());
        if (vSocketId) { //검증자가 현재 온라인이며 소켓 ID가 존재할 때만 이벤트 전송 수행
          io.to(vSocketId).emit('verificationRequested', {
            candidate,
            nickname,
            message: `${nickname}(${candidate}) 님이 신규 입장 요청을 하였습니다.`, 
            //추후에 링크, 미리보기도 추가
            validators: pendingVerifications[candidate].validators,
          });
        }
      }

      console.log(`입장 요청: ${candidate}, 닉네임: ${nickname}, 검증자: ${pendingVerifications[candidate].validators.join(', ')}`);

    } catch (err) {
      console.error('requestEntry 처리 중 에러:', err);
    }
  });

  socket.on('vote', ({ candidate, verifier, approve }) => {

    verifier = verifier.toLowerCase();

    if (pendingVerifications[candidate].votes[verifier] !== undefined) return;
    pendingVerifications[candidate].votes[verifier] = !!approve;
    const totalVotes = Object.keys(pendingVerifications[candidate].votes).length;
    const totalValidators = pendingVerifications[candidate].validators.length;
    if (totalVotes === totalValidators) {
      // 투표 완료 시 최종 처리 함수 호출
      finalizeVerification(candidate);
    }
  });

  socket.on('disconnect', () => {
    for (const [wallet, id] of userSockets.entries()) {
      if (id === socket.id) userSockets.delete(wallet);
    } //userSockets 맵에서 현재 끊어진 소켓 ID와 매칭되는 지갑 주소를 찾아 삭제
    for (const [validator, id] of validatorSockets.entries()) {
      if (id === socket.id) validatorSockets.delete(validator);
    }
  }); //validatorSockets 맵에서도 해당 소켓 ID의 검증자 지갑 주소를 찾아 삭제
  });

function finalizeVerification(candidate) {
  const data = pendingVerifications[candidate];
  if (!data) return;

  const approvals = Object.values(data.votes).filter(v => v).length; //.length : 찬성 투표 수 셈
  const total = data.validators.length; //투표에 참여한 총 검증자 수
  const approved = approvals * 3 >= total * 2; // 2/3 이상 찬성 시 승인

  if (approved) {
    console.log(`✅ ${candidate} 승인 (${approvals}/${total})`);
  } else {
    console.log(`❌ ${candidate} 거절 (${approvals}/${total})`);
  } //최종 승인(approved가 참)이면 서버 콘솔에 "승인" 로그를 출력하고, 거절이면 "거절" 로그를 출력
  const socketId = userSockets.get(candidate);
  if (socketId) {
    io.to(socketId).emit('verificationCompleted', { candidate, approved });
  }
  data.validators.forEach(v => {
    const vId = validatorSockets.get(v.toLowerCase());
    if (vId) io.to(vId).emit('verificationResult', { candidate, approved });
  });

  delete pendingVerifications[candidate];
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, { 
    maxHttpBufferSize: 1e8, // 100MB
    cors: { origin: "*" } 
});

// الحالة الافتراضية للعبة (لفصلها واستدعائها عند إعادة الضبط)
const initialGameState = {
    teams: {
        group1: { name: "الفريق 1", score: 0, logo: null, video: null },
        group2: { name: "الفريق 2", score: 0, logo: null, video: null }
    },
    activeRound: 0,
    currentQuestion: null,
    currentQuestionIndex: 0, 
    currentTurn: 'group1',   
    buzzerWinner: null,
    revealAnswer: false,     
    timer: 60,               
    selections: { group1: null, group2: null }, 
    wrongAnswers: { group1: false, group2: false },
    isGameOver: false,
    selectedLevel: null 
};

let gameState = JSON.parse(JSON.stringify(initialGameState));
let activeTimerInterval = null;

app.use(express.static(path.join(__dirname, 'public')));

// وظائف التحكم في الوقت
function stopTimer() {
    if (activeTimerInterval) {
        clearInterval(activeTimerInterval);
        activeTimerInterval = null;
    }
}

function startTimer() {
    stopTimer();
    gameState.timer = 60;
    io.emit('timerUpdate', gameState.timer);
    
    activeTimerInterval = setInterval(() => {
        if (gameState.timer > 0) {
            gameState.timer--;
            io.emit('timerUpdate', gameState.timer);
        } else {
            stopTimer();
            // عند انتهاء الوقت في جولات معينة، نكشف الإجابة آلياً
            if ((gameState.activeRound === 1 || gameState.activeRound === 3) && !gameState.revealAnswer) {
                gameState.revealAnswer = true;
                io.emit('gameStateUpdate', gameState);
                // تبديل الدور بعد 4 ثوانٍ من انتهاء الوقت
                setTimeout(handleTurnSwitch, 4000);
            }
        }
    }, 1000);
}

function handleTurnSwitch() {
    stopTimer();
    // تبديل الدور
    gameState.currentTurn = (gameState.currentTurn === 'group1') ? 'group2' : 'group1';
    // تنظيف حالة السؤال الحالي استعداداً للقادم
    gameState.selectedLevel = null; 
    gameState.currentQuestion = null; 
    gameState.revealAnswer = false;
    gameState.buzzerWinner = null;
    gameState.wrongAnswers = { group1: false, group2: false };
    gameState.selections = { group1: null, group2: null };
    io.emit('gameStateUpdate', gameState);
}

io.on('connection', (socket) => {
    socket.emit('gameStateUpdate', gameState);

    // 1. إعداد اللعبة بالكامل
    socket.on('setupGame', (data) => {
        gameState.teams.group1.name = data.t1 || "الفريق 1";
        gameState.teams.group1.logo = data.logo1 || null;
        gameState.teams.group1.video = data.video1 || null;
        
        gameState.teams.group2.name = data.t2 || "الفريق 2";
        gameState.teams.group2.logo = data.logo2 || null;
        gameState.teams.group2.video = data.video2 || null;

        gameState.isGameOver = false;
        io.emit('gameStateUpdate', gameState);
    });

    // 2. تغيير الجولة
    socket.on('changeRound', (r) => {
        gameState.activeRound = parseInt(r);
        gameState.currentQuestionIndex = 0;
        gameState.currentQuestion = null;
        gameState.selectedLevel = null;
        gameState.revealAnswer = false;
        gameState.buzzerWinner = null;
        gameState.selections = { group1: null, group2: null };
        gameState.wrongAnswers = { group1: false, group2: false };
        stopTimer();
        io.emit('gameStateUpdate', gameState);
    });

    // 3. دفع سؤال جديد
    socket.on('pushQuestion', (q) => {
        if (!q) return;
        gameState.currentQuestion = q;
        gameState.currentQuestionIndex++; 
        gameState.revealAnswer = false;
        gameState.buzzerWinner = null;
        gameState.selections = { group1: null, group2: null };
        gameState.wrongAnswers = { group1: false, group2: false };
        
        startTimer(); 
        io.emit('gameStateUpdate', gameState);
    });

    // 4. معالجة الإجابات (تم تحسين خصم النقاط في جولة التحدي)
    socket.on('submitAnswer', (data) => {
        if (!gameState.currentQuestion || gameState.revealAnswer) return;
        
        const isCorrect = (data.answerIdx === gameState.currentQuestion.answer);
        const points = parseInt(gameState.currentQuestion.points) || 5;
        const teamId = data.teamId;

        if (isCorrect) {
            gameState.teams[teamId].score += points;
            gameState.revealAnswer = true;
            stopTimer();
            // في الجولة 1 و 3 ننتقل للدور التالي، في جولة السرعة (2) ننتظر السؤال القادم
            if (gameState.activeRound !== 2) setTimeout(handleTurnSwitch, 4000);
        } else {
            // إجابة خاطئة
            if (gameState.activeRound === 1 || gameState.activeRound === 3) {
                if(gameState.activeRound === 3) {
                    gameState.teams[teamId].score = Math.max(0, gameState.teams[teamId].score - points);
                }
                gameState.revealAnswer = true;
                stopTimer();
                setTimeout(handleTurnSwitch, 4000);
            } else if (gameState.activeRound === 2) {
                gameState.wrongAnswers[teamId] = true;
                // إذا أخطأ الأول، يتحول "الفوز بالبازر" آلياً للثاني
                gameState.buzzerWinner = (teamId === 'group1') ? 'group2' : 'group1';
                
                if (gameState.wrongAnswers.group1 && gameState.wrongAnswers.group2) {
                    gameState.revealAnswer = true;
                    stopTimer();
                }
            }
        }
        io.emit('gameStateUpdate', gameState);
    });

    // 5. ميزة إعادة الضبط الشاملة (المطلوبة للزر الجديد)
    socket.on('resetGameFull', () => {
        stopTimer();
        gameState = JSON.parse(JSON.stringify(initialGameState));
        io.emit('gameStateUpdate', gameState);
    });

    // 6. اختيار المستوى في جولة التحدي
    socket.on('selectLevel', (data) => {
        if (gameState.activeRound === 3 && data.team === gameState.currentTurn) {
            gameState.selectedLevel = data.level;
            io.emit('levelSelectedAlert', { 
                teamName: gameState.teams[data.team].name, 
                level: data.level, 
                team: data.team 
            });
            io.emit('gameStateUpdate', gameState);
        }
    });

    // 7. البازر
    socket.on('pressBuzzer', (teamId) => {
        if (gameState.activeRound === 2 && !gameState.buzzerWinner && !gameState.wrongAnswers[teamId]) {
            gameState.buzzerWinner = teamId;
            stopTimer();
            io.emit('buzzerWon', teamId);
            io.emit('gameStateUpdate', gameState);
        }
    });

    // 8. أوامر مباشرة من لوحة التحكم
    socket.on('revealAnswer', () => {
        stopTimer();
        gameState.revealAnswer = true;
        io.emit('gameStateUpdate', gameState);
    });

    socket.on('resetBuzzer', () => {
        gameState.buzzerWinner = null;
        gameState.wrongAnswers = { group1: false, group2: false };
        io.emit('gameStateUpdate', gameState);
    });

    socket.on('manualScore', (data) => {
        if (gameState.teams[data.team]) {
            gameState.teams[data.team].score += data.val;
            io.emit('gameStateUpdate', gameState);
        }
    });

    socket.on('updateSelection', (data) => {
        gameState.selections[data.teamId] = data.answerIdx;
        io.emit('gameStateUpdate', gameState);
    });

    socket.on('endGame', () => {
        gameState.isGameOver = true;
        stopTimer();
        io.emit('gameStateUpdate', gameState);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server live on port ${PORT}`);
});
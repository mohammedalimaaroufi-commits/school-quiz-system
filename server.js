const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { 
    maxHttpBufferSize: 1e7, 
    cors: { origin: "*" } 
});

let gameState = {
    teams: {
        group1: { name: "الفريق 1", score: 0, logo: null },
        group2: { name: "الفريق 2", score: 0, logo: null }
    },
    activeRound: 0,
    currentQuestion: null,
    currentTurn: 'group1',   
    buzzerWinner: null,
    revealAnswer: false,     
    timer: 60,               
    selections: { group1: null, group2: null },
    wrongAnswers: { group1: false, group2: false },
    isGameOver: false,
    selectedLevel: null // لتخزين المستوى المختار في الجولة 3
};

let activeTimerInterval = null;

app.use(express.static(path.join(__dirname, 'public')));

function startTimer() {
    clearInterval(activeTimerInterval);
    gameState.timer = 60;
    io.emit('timerUpdate', gameState.timer);
    
    activeTimerInterval = setInterval(() => {
        if (gameState.timer > 0) {
            gameState.timer--;
            io.emit('timerUpdate', gameState.timer);
        } else {
            clearInterval(activeTimerInterval);
        }
    }, 1000);
}

io.on('connection', (socket) => {
    socket.emit('gameStateUpdate', gameState);

    // 1. إعداد المسابقة
    socket.on('setupGame', (data) => {
        gameState.teams.group1 = { name: data.t1, score: 0, logo: data.logo1 };
        gameState.teams.group2 = { name: data.t2, score: 0, logo: data.logo2 };
        gameState.activeRound = 1;
        gameState.currentTurn = 'group1';
        gameState.isGameOver = false;
        io.emit('gameStateUpdate', gameState);
    });

    // 2. تغيير الجولة
    socket.on('changeRound', (r) => {
        gameState.activeRound = parseInt(r);
        gameState.currentQuestion = null;
        gameState.buzzerWinner = null;
        gameState.revealAnswer = false;
        gameState.selectedLevel = null;
        gameState.selections = { group1: null, group2: null };
        gameState.wrongAnswers = { group1: false, group2: false };
        
        if (gameState.activeRound === 3) gameState.currentTurn = 'group1';
        
        clearInterval(activeTimerInterval);
        io.emit('gameStateUpdate', gameState);
    });

    // 3. دفع سؤال جديد (تعديل لدعم نقاط المستويات)
    socket.on('pushQuestion', (q) => {
        // إذا كنا في الجولة 3، نعتمد نقاط المستوى المختار
        if (gameState.activeRound === 3 && gameState.selectedLevel) {
            const levelPoints = { 'normal': 2, 'hard': 5, 'super': 10 };
            q.points = levelPoints[gameState.selectedLevel] || 2;
        }

        gameState.currentQuestion = q;
        gameState.revealAnswer = false;
        gameState.buzzerWinner = null;
        gameState.selections = { group1: null, group2: null };
        gameState.wrongAnswers = { group1: false, group2: false };
        
        startTimer(); 
        io.emit('gameStateUpdate', gameState);
    });

    // 4. الاختيار اللحظي
    socket.on('updateSelection', (data) => {
        gameState.selections[data.teamId] = data.answerIdx;
        io.emit('gameStateUpdate', gameState);
    });

    // 5. معالجة الإجابة
    socket.on('submitAnswer', (data) => {
        if (!gameState.currentQuestion || gameState.revealAnswer) return;

        const isCorrect = (data.answerIdx === gameState.currentQuestion.answer);
        const points = parseInt(gameState.currentQuestion.points) || 5;
        const currentTeam = data.teamId;
        const opponentTeam = (currentTeam === 'group1') ? 'group2' : 'group1';

        if (isCorrect) {
            gameState.teams[currentTeam].score += points;
            gameState.revealAnswer = true;
            clearInterval(activeTimerInterval);
        } else {
            if (gameState.activeRound === 1) {
                gameState.revealAnswer = true;
                clearInterval(activeTimerInterval);
            } 
            else if (gameState.activeRound === 2) {
                gameState.wrongAnswers[currentTeam] = true;
                gameState.selections[currentTeam] = null;
                if (!gameState.wrongAnswers[opponentTeam]) {
                    gameState.buzzerWinner = opponentTeam;
                } else {
                    gameState.revealAnswer = true;
                    clearInterval(activeTimerInterval);
                }
            }
            else if (gameState.activeRound === 3) {
                // الجولة 3: خصم نفس عدد النقاط المخصصة للسؤال في حالة الخطأ
                gameState.teams[currentTeam].score -= points;
                gameState.revealAnswer = true;
                clearInterval(activeTimerInterval);
            }
        }

        // تبديل الأدوار في الجولات 1 و 3
        if ((gameState.activeRound === 1 || gameState.activeRound === 3) && gameState.revealAnswer) {
            gameState.currentTurn = opponentTeam;
            gameState.selectedLevel = null; // إعادة ضبط المستوى للسؤال القادم
        }

        io.emit('gameStateUpdate', gameState);
    });

    // 6. البازر
    socket.on('pressBuzzer', (teamId) => {
        if (gameState.activeRound === 2 && !gameState.buzzerWinner && !gameState.wrongAnswers[teamId]) {
            gameState.buzzerWinner = teamId;
            io.emit('gameStateUpdate', gameState);
        }
    });

    // 7. اختيار المستوى (الجولة الثالثة) - مُحدث
    socket.on('selectLevel', (data) => {
        if (gameState.activeRound === 3 && data.team === gameState.currentTurn) {
            gameState.selectedLevel = data.level;
            const teamName = gameState.teams[data.team].name;
            // إرسال تنبيه للوحة التحكم
            io.emit('levelSelectedAlert', { teamName, level: data.level });
            io.emit('gameStateUpdate', gameState);
        }
    });

    // 8. التحكم اليدوي والإنهاء
    socket.on('endGame', () => {
        gameState.isGameOver = true;
        clearInterval(activeTimerInterval);
        io.emit('gameStateUpdate', gameState);
    });

    socket.on('manualScore', (data) => {
        if (gameState.teams[data.team]) {
            gameState.teams[data.team].score += data.val;
            io.emit('gameStateUpdate', gameState);
        }
    });

    socket.on('revealAnswer', () => {
        clearInterval(activeTimerInterval);
        gameState.revealAnswer = true;
        io.emit('gameStateUpdate', gameState);
    });

    socket.on('resetFull', () => {
        gameState.teams.group1.score = 0;
        gameState.teams.group2.score = 0;
        gameState.activeRound = 0;
        gameState.currentQuestion = null;
        gameState.selectedLevel = null;
        gameState.isGameOver = false;
        clearInterval(activeTimerInterval);
        io.emit('gameStateUpdate', gameState);
    });

    socket.on('resetBuzzer', () => {
        gameState.buzzerWinner = null;
        gameState.wrongAnswers = { group1: false, group2: false };
        io.emit('gameStateUpdate', gameState);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يعمل بنجاح على المنفذ ${PORT}`);
});
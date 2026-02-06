const socket = io();

// Écouter les mises à jour de l'état du jeu
socket.on('gameStateUpdate', (state) => {
    // Mise à jour des noms
    document.getElementById('team1-display').innerText = state.teams.group1.name;
    document.getElementById('team2-display').innerText = state.teams.group2.name;

    // Mise à jour des scores
    document.getElementById('score1').innerText = state.teams.group1.score;
    document.getElementById('score2').innerText = state.teams.group2.score;

    // Mise à jour du titre du Round
    const rounds = ["استعداد", "الجولة الأولى", "الجولة الثانية", "الجولة الثالثة"];
    document.getElementById('round-title').innerText = rounds[state.activeRound];
});

// Écouter l'arrivée d'une nouvelle question
socket.on('newQuestion', (question) => {
    document.getElementById('question-text').innerText = question.question;
    const container = document.getElementById('options-container');
    container.innerHTML = ''; // Vide les anciennes réponses

    if (question.options) {
        question.options.forEach((opt, index) => {
            const div = document.createElement('div');
            div.className = 'option-item';
            div.innerText = opt;
            container.appendChild(div);
        });
    }
});

// Gestion du Buzzer visuel
socket.on('buzzerLocked', (teamId) => {
    document.querySelectorAll('.team-card').forEach(card => card.classList.remove('active-buzz'));
    document.getElementById(`card-${teamId}`).classList.add('active-buzz');
});
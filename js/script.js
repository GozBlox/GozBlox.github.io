document.addEventListener('DOMContentLoaded', async () => {
    const tbody = document.getElementById('table-body');
    try {
        const response = await fetch('ranking.json');
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();
        renderTable(data);
    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="3" class="loading">Error loading rankings. Please try again.</td></tr>';
    }
});

function renderTable(rankings) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    rankings.forEach(team => {
        const row = document.createElement('tr');

        const rankCell = document.createElement('td');
        rankCell.className = 'rank';
        rankCell.textContent = team.rank;
        row.appendChild(rankCell);

        const teamCell = document.createElement('td');
        teamCell.className = 'team-cell';

        // Flag image from Flagcdn (or any CDN)
        const flagImg = document.createElement('img');
        flagImg.className = 'flag';
        flagImg.src = `https://flagcdn.com/64x48/${team.code.toLowerCase()}.png`;
        flagImg.alt = `${team.name} flag`;
        flagImg.loading = 'lazy';

        const arrowSpan = document.createElement('span');
        arrowSpan.className = 'arrow-icon';
        let arrowIcon, arrowClass;
        if (team.previous_rank > team.rank) {
            arrowClass = 'arrow-up';
            arrowIcon = '<i class="fas fa-arrow-up"></i>';
        } else if (team.previous_rank < team.rank) {
            arrowClass = 'arrow-down';
            arrowIcon = '<i class="fas fa-arrow-down"></i>';
        } else {
            arrowClass = 'arrow-steady';
            arrowIcon = '<i class="fas fa-arrows-up-down"></i>';
        }
        arrowSpan.className = `arrow-icon ${arrowClass}`;
        arrowSpan.innerHTML = arrowIcon;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'team-name';
        nameSpan.textContent = team.name;

        teamCell.appendChild(flagImg);
        teamCell.appendChild(arrowSpan);
        teamCell.appendChild(nameSpan);
        row.appendChild(teamCell);

        const pointsCell = document.createElement('td');
        pointsCell.className = 'points-container';

        const pointsValue = document.createElement('span');
        pointsValue.className = 'points-value';
        pointsValue.textContent = team.points.toFixed(2);

        const pointsChange = document.createElement('span');
        pointsChange.className = 'points-change';
        const change = team.points_change;
        let changeText, changeClass;
        if (change > 0) {
            changeText = `+${change.toFixed(2)}`;
            changeClass = 'positive';
        } else if (change < 0) {
            changeText = `-${Math.abs(change).toFixed(2)}`;
            changeClass = 'negative';
        } else {
            changeText = `+${change.toFixed(2)}`;
            changeClass = 'positive';
        }
        pointsChange.textContent = changeText;
        pointsChange.classList.add(changeClass);

        pointsCell.appendChild(pointsValue);
        pointsCell.appendChild(pointsChange);
        row.appendChild(pointsCell);

        tbody.appendChild(row);
    });
}
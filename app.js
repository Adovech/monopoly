var App = {
    State: {
        roomId: null,
        myId: null,
        roomData: null,
        localRolling: false,
        gridRendered: false
    },

    Network: {
        createRoom: function() {
            var nick = document.getElementById('input-corp-name').value.trim();
            if(!nick) return alert("Помилка: Введіть назву вашої корпорації!");

            App.State.myId = "corp_" + Math.random().toString(36).substring(2, 9);
            var role = document.getElementById('select-corp-role').value;
            App.State.roomId = Math.floor(100000 + Math.random() * 900000).toString();

            var startingCash = GameConfig.startingCash;
            if(role === 'banker') startingCash = 2000;

            var initialRoomStructure = {
                status: "waiting",
                host: App.State.myId,
                turnIndex: 0,
                order: [App.State.myId],
                pendingAction: null,
                lastRoll: { d1: 1, d2: 1, sum: 2 },
                players: {},
                cells: {},
                logs: [{ type: "sys", text: `🏢 Корпорація ${nick} заснувала нове лобі інвесторів. Очікування опонентів.` }]
            };

            initialRoomStructure.players[App.State.myId] = {
                id: App.State.myId,
                name: nick,
                role: role,
                cash: startingCash,
                pos: 0,
                color: GameConfig.tokenColors[0],
                inJail: 0
            };

            GameConfig.mapData.forEach(function(tile) {
                initialRoomStructure.cells[tile.id] = { owner: "", lvl: 0 };
            });

            db.ref('rooms/' + App.State.roomId).set(initialRoomStructure, function(err) {
                if(!err) {
                    App.Network.connectAndListen();
                } else {
                    alert("Помилка підключення до бази даних!");
                }
            });
        },

        joinRoomPrompt: function() {
            var nick = document.getElementById('input-corp-name').value.trim();
            if(!nick) return alert("Помилка: Спочатку введіть назву вашої корпорації!");

            var targetId = prompt("Введіть 6-значний цифровий код кімнати:");
            if(!targetId) return;
            App.State.roomId = targetId.trim();

            db.ref('rooms/' + App.State.roomId).once('value', function(snap) {
                if(!snap.exists()) return alert("Кімнату з таким кодом не знайдено!");
                var room = snap.val();
                if(room.status !== "waiting") return alert("Сесія вже активна!");

                var currentPlayersCount = Object.keys(room.players).length;
                if(currentPlayersCount >= 4) return alert("У кімнаті вже є макс. кількість гравців!");

                App.State.myId = "corp_" + Math.random().toString(36).substring(2, 9);
                var role = document.getElementById('select-corp-role').value;
                var startingCash = GameConfig.startingCash;
                if(role === 'banker') startingCash = 2000;

                var currentOrder = room.order || [];
                currentOrder.push(App.State.myId);

                var newPlayerData = {
                    id: App.State.myId,
                    name: nick,
                    role: role,
                    cash: startingCash,
                    pos: 0,
                    color: GameConfig.tokenColors[currentPlayersCount],
                    inJail: 0
                };

                var updates = {};
                updates['/players/' + App.State.myId] = newPlayerData;
                updates['/order'] = currentOrder;
                updates['/logs/' + (room.logs ? room.logs.length : 0)] = { 
                    type: "sys", 
                    text: `🤝 Корпорація ${nick} увійшла на ринок. Учасників: ${currentOrder.length}/4.` 
                };

                db.ref('rooms/' + App.State.roomId).update(updates, function(err) {
                    if(!err) App.Network.connectAndListen();
                });
            });
        },

        connectAndListen: function() {
            document.getElementById('waiting-area').style.display = 'block';
            document.getElementById('lobby-code-display').innerText = App.State.roomId;
            document.getElementById('btn-action-create').disabled = true;
            document.getElementById('btn-action-join').disabled = true;

            db.ref('rooms/' + App.State.roomId).on('value', function(snap) {
                if(!snap.exists()) return;
                var data = snap.val();
                App.State.roomData = data;

                var currentCount = Object.keys(data.players).length;
                document.getElementById('lobby-connected-counter').innerText = currentCount;

                if(data.host === App.State.myId && data.status === "waiting") {
                    document.getElementById('btn-matchmaker-start').style.display = 'block';
                }

                if(data.status === "active") {
                    document.getElementById('auth-screen').style.display = 'none';
                    document.getElementById('game-screen').style.display = 'block';
                    document.getElementById('game-screen').style.opacity = '1';
                    App.UI.syncRealtimeData();
                }
            });
        },

        startMatch: function() {
            if(!App.State.roomData || Object.keys(App.State.roomData.players).length < 2) {
                return alert("Необхідно мінімум 2 гравці для початку гри!");
            }
            db.ref('rooms/' + App.State.roomId).update({ status: "active" });
        }
    },

    Gameplay: {
        rollDice: function() {
            var r = App.State.roomData;
            var activeId = r.order[r.turnIndex];
            if(activeId !== App.State.myId || App.State.localRolling || r.pendingAction) return;

            var me = r.players[App.State.myId];
            var logIdx = r.logs ? r.logs.length : 0;

            if(me.inJail > 0) {
                var payJail = confirm(`Корпорація в СІЗО. Сплатити $100 за заставу, щоб вийти зараз?`);
                if(payJail) {
                    var updates = {};
                    updates['/players/' + App.State.myId + '/inJail'] = 0;
                    updates['/players/' + App.State.myId + '/cash'] = me.cash - 100;
                    updates['/logs/' + logIdx] = { type: "warn", text: `💸 ${me.name} вносить заставу $100 та виходить на волю!` };
                    db.ref('rooms/' + App.State.roomId).update(updates);
                    return;
                } else {
                    var updates = {};
                    updates['/players/' + App.State.myId + '/inJail'] = me.inJail - 1;
                    updates['/logs/' + logIdx] = { type: "warn", text: `🚔 ${me.name} відбуває термін в СІЗО. Хід пропущено.` };
                    App.Gameplay.nextTurn(updates);
                    db.ref('rooms/' + App.State.roomId).update(updates);
                    return;
                }
            }

            App.State.localRolling = true;
            document.getElementById('dice-status-subtext').innerText = "🎲 КУБИКИ ОБЕРТАЮТЬСЯ...";

            var ticks = 0;
            var num1 = 1, num2 = 1;
            
            var interval = setInterval(function() {
                num1 = Math.floor(Math.random() * 6) + 1;
                num2 = Math.floor(Math.random() * 6) + 1;
                document.getElementById('cube-node-1').innerText = App.UI.getDiceSymbol(num1);
                document.getElementById('cube-node-2').innerText = App.UI.getDiceSymbol(num2);
                ticks++;

                if(ticks > 12) {
                    clearInterval(interval);
                    App.State.localRolling = false;
                    App.Gameplay.finalizeDiceMove(num1, num2);
                }
            }, 80);
        },

        finalizeDiceMove: function(d1, d2) {
            var r = App.State.roomData;
            var me = r.players[App.State.myId];
            var totalSteps = d1 + d2;
            var oldPos = me.pos;
            var targetPos = (me.pos + totalSteps) % GameConfig.totalCells;

            var currentLogsCount = r.logs ? r.logs.length : 0;
            var updates = {};

            updates['/players/' + App.State.myId + '/pos'] = targetPos;
            updates['/lastRoll'] = { d1: d1, d2: d2, sum: totalSteps };
            updates['/logs/' + currentLogsCount] = { 
                type: "sys", 
                text: `🎲 ${me.name} викидає [${d1}:${d2}] та переміщується на клітину ${targetPos}.` 
            };

            if(targetPos < oldPos) {
                var circleBonus = me.role === 'shark' ? 450 : GameConfig.baseSalary;
                updates['/players/' + App.State.myId + '/cash'] = me.cash + circleBonus;
                updates['/logs/' + (currentLogsCount + 1)] = { 
                    type: "good", 
                    text: `💸 Ринкове коло закрите! ${me.name} отримує дивіденди +$${circleBonus}` 
                };
            }

            var tileObj = GameConfig.mapData[targetPos];
            var tileServerState = r.cells[targetPos];

            if((tileObj.type === "property" || tileObj.type === "utility") && !tileServerState.owner) {
                updates['/pendingAction'] = { type: "buy", tileId: targetPos, actor: App.State.myId };
            } 
            else if(tileServerState.owner && tileServerState.owner !== App.State.myId) {
                updates['/pendingAction'] = { type: "rent", tileId: targetPos, actor: App.State.myId };
            } 
            else if(tileObj.type === "tax") {
                updates['/pendingAction'] = { type: "tax", tileId: targetPos, actor: App.State.myId };
            } 
            else if(tileObj.type === "chance" || tileObj.type === "chest") {
                updates['/pendingAction'] = { type: "event", tileId: targetPos, actor: App.State.myId };
            } 
            else if(tileObj.type === "gotojail") {
                updates['/players/' + App.State.myId + '/pos'] = 8;
                updates['/players/' + App.State.myId + '/inJail'] = 3;
                updates['/logs/' + (currentLogsCount + 2)] = { 
                    type: "alert", 
                    text: `🚔 Компанію ${me.name} арештовано та відправлено в СІЗО.` 
                };
            }

            db.ref('rooms/' + App.State.roomId).update(updates);
        },

        executeBusinessAction: function() {
            var r = App.State.roomData;
            var act = r.pendingAction;
            var me = r.players[App.State.myId];
            var tile = GameConfig.mapData[act.tileId];
            var serverTile = r.cells[act.tileId];
            var logLength = r.logs ? r.logs.length : 0;

            var updates = {};

            if(act.type === "buy") {
                if(me.cash < tile.price) return alert("Брак коштів для покупки активу!");
                
                updates['/players/' + App.State.myId + '/cash'] = me.cash - tile.price;
                updates['/cells/' + act.tileId + '/owner'] = App.State.myId;
                if(tile.type === "property") updates['/cells/' + act.tileId + '/lvl'] = 1;
                
                updates['/logs/' + logLength] = { type: "good", text: `💼 ${me.name} придбав актив: ${tile.name} за $${tile.price}.` };
                updates['/pendingAction'] = null;
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            } 
            else if(act.type === "build") {
                var buildCost = Math.round(tile.price * 0.6);
                if(me.role === "tycoon") buildCost = Math.round(buildCost * 0.7);

                if(me.cash < buildCost) return alert("Брак ліквідності для модернізації!");

                updates['/players/' + App.State.myId + '/cash'] = me.cash - buildCost;
                updates['/cells/' + act.tileId + '/lvl'] = serverTile.lvl + 1;
                updates['/logs/' + logLength] = { 
                    type: "good", 
                    text: `🏢 ${me.name} модернізує ${tile.name}. Рівень підвищено до ${serverTile.lvl + 1}.` 
                };
                updates['/pendingAction'] = null;
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            } 
            else if(act.type === "rent") {
                var hostCorp = r.players[serverTile.owner];
                var finalRent = App.Gameplay.calculateRentFormula(tile, serverTile, r);

                updates['/players/' + App.State.myId + '/cash'] = me.cash - finalRent;
                updates['/players/' + serverTile.owner + '/cash'] = hostCorp.cash + finalRent;
                updates['/logs/' + logLength] = { 
                    type: "alert", 
                    text: `⚠️ Оренда: ${me.name} виплачує $${finalRent} гравцю ${hostCorp.name}.` 
                };
                updates['/pendingAction'] = null;

                App.Gameplay.evaluateBankruptcyState(me.cash - finalRent, updates);
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            } 
            else if(act.type === "tax") {
                updates['/players/' + App.State.myId + '/cash'] = me.cash - tile.cost;
                updates['/logs/' + logLength] = { type: "alert", text: `🏛️ Податки: ${me.name} сплачує в бюджет $${tile.cost}.` };
                updates['/pendingAction'] = null;

                App.Gameplay.evaluateBankruptcyState(me.cash - tile.cost, updates);
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            } 
            else if(act.type === "event") {
                var randomCard = GameConfig.chanceCards[Math.floor(Math.random() * GameConfig.chanceCards.length)];
                var calculatedCash = me.cash;

                if(randomCard.type === "gift") calculatedCash += randomCard.sum;
                if(randomCard.type === "fine") calculatedCash -= randomCard.sum;

                updates['/players/' + App.State.myId + '/cash'] = calculatedCash;
                updates['/logs/' + logLength] = { type: "warn", text: `📜 ПОДІЯ: ${randomCard.text}` };
                updates['/pendingAction'] = null;

                if(randomCard.type === "fine") App.Gameplay.evaluateBankruptcyState(calculatedCash, updates);
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            }
        },

        confirmPass: function() {
            var r = App.State.roomData;
            if(r.order[r.turnIndex] !== App.State.myId || r.pendingAction) return;
            var updates = {};
            App.Gameplay.nextTurn(updates);
            db.ref('rooms/' + App.State.roomId).update(updates);
        },

        nextTurn: function(updates) {
            var r = App.State.roomData;
            updates['/turnIndex'] = (r.turnIndex + 1) % r.order.length;
        },

        calculateRentFormula: function(tile, serverTile, r) {
            if(tile.type === "property") {
                return tile.rent[serverTile.lvl] || tile.rent[0];
            }
            if(tile.type === "utility") {
                var count = Object.keys(r.cells).filter(function(k) {
                    return GameConfig.mapData[k].group === "util" && r.cells[k].owner === serverTile.owner;
                }).length;
                var cubesSum = r.lastRoll ? r.lastRoll.sum : 7;
                return cubesSum * (count === 3 ? 15 : 6);
            }
            return 0;
        },

        evaluateBankruptcyState: function(balance, updates) {
            if(balance < 0) {
                var me = App.State.roomData.players[App.State.myId];
                var logL = App.State.roomData.logs ? App.State.roomData.logs.length : 0;
                
                updates['/logs/' + (logL + 4)] = { 
                    type: "alert", 
                    text: `💀 КРАХ: Корпорація ${me.name} оголосила банкрутство!` 
                };

                GameConfig.mapData.forEach(function(tile) {
                    if(App.State.roomData.cells[tile.id].owner === App.State.myId) {
                        updates['/cells/' + tile.id + '/owner'] = "";
                        updates['/cells/' + tile.id + '/lvl'] = 0;
                    }
                });

                var updatedOrder = App.State.roomData.order.filter(function(id) { return id !== App.State.myId; });
                updates['/order'] = updatedOrder;
                updates['/players/' + App.State.myId] = null;
                
                alert("Ви збанкрутували!");
            }
        }
    },

    UI: {
        buildLayoutMatrix: function() {
            var container = document.getElementById('board-grid-dom-target');
            var coreHTML = container.querySelector('.board-center-core').outerHTML;
            container.innerHTML = coreHTML;

            GameConfig.mapData.forEach(function(tile) {
                var node = document.createElement('div');
                node.className = `cell-unit pos-${tile.id}`;

                if(tile.id <= 8) node.classList.add('border-top-side');
                else if(tile.id <= 16) node.classList.add('border-right-side');
                else if(tile.id <= 24) node.classList.add('border-bottom-side');
                else node.classList.add('border-left-side');

                var stripe = GameConfig.groupColors[tile.group] || "transparent";

                node.innerHTML = `
                    <div class="cell-stripe-indicator" style="background:${stripe}"></div>
                    <div class="cell-level-container" id="lvl-box-${tile.id}"></div>
                    <div class="cell-meta-title">${tile.name}</div>
                    <div class="cell-center-graphic">${tile.icon || '💼'}</div>
                    <div class="cell-owner-label" id="owner-box-${tile.id}"></div>
                    <div class="cell-price-tag">${tile.price ? '$' + tile.price : (tile.cost ? '$' + tile.cost : '')}</div>
                    <div class="cell-tokens-tray" id="tray-box-${tile.id}"></div>
                `;
                container.appendChild(node);
            });
            App.State.gridRendered = true;
        },

        getDiceSymbol: function(n) {
            return { 1: "⚀", 2: "⚁", 3: "⚂", 4: "⚃", 5: "⚄", 6: "⚅" }[n] || "⚀";
        },

        syncRealtimeData: function() {
            if(!App.State.gridRendered) App.UI.buildLayoutMatrix();

            var r = App.State.roomData;
            var activeId = r.order[r.turnIndex];
            var activeCorp = r.players[activeId];

            GameConfig.mapData.forEach(function(tile) {
                var serverTile = r.cells[tile.id];
                var tray = document.getElementById(`tray-box-${tile.id}`);
                if(tray) tray.innerHTML = "";

                var label = document.getElementById(`owner-box-${tile.id}`);
                var lvlContainer = document.getElementById(`lvl-box-${tile.id}`);

                if(serverTile && serverTile.owner) {
                    var ownerMeta = r.players[serverTile.owner];
                    if(label && ownerMeta) {
                        label.innerText = ownerMeta.name.substring(0, 5) + '.';
                        label.style.background = ownerMeta.color;
                        label.style.color = "#000";
                    }
                    if(lvlContainer && tile.type === 'property') {
                        lvlContainer.innerHTML = "";
                        if(serverTile.lvl === 6) {
                            lvlContainer.innerHTML = `<div class="infrastructure-hotel"></div>`;
                        } else {
                            for(var i = 1; i < serverTile.lvl; i++) {
                                lvlContainer.innerHTML += `<div class="infrastructure-house"></div>`;
                            }
                        }
                    }
                } else {
                    if(label) label.innerText = "";
                    if(lvlContainer) lvlContainer.innerHTML = "";
                }
            });

            Object.values(r.players).forEach(function(p) {
                if(!p) return;
                var pawn = document.createElement('div');
                pawn.className = "player-pawn";
                pawn.style.background = p.color;
                var currentTray = document.getElementById(`tray-box-${p.pos}`);
                if(currentTray) currentTray.appendChild(pawn);
            });

            var leaderboardContainer = document.getElementById('leaderboard-in-game-target');
            leaderboardContainer.innerHTML = "";
            r.order.forEach(function(id) {
                var p = r.players[id];
                if(!p) return;
                leaderboardContainer.innerHTML += `
                    <div class="leaderboard-row ${activeId === p.id ? 'current-active-player' : ''}">
                        <div class="corp-identity-box">
                            <strong style="color:${p.color}">${p.name} ${p.id === App.State.myId ? '(Ви)' : ''}</strong>
                            <div>Класс: ${p.role}</div>
                        </div>
                        <div class="corp-financial-balance">$${p.cash}</div>
                    </div>
                `;
            });

            if(r.lastRoll && !App.State.localRolling) {
                document.getElementById('cube-node-1').innerText = App.UI.getDiceSymbol(r.lastRoll.d1);
                document.getElementById('cube-node-2').innerText = App.UI.getDiceSymbol(r.lastRoll.d2);
            }

            document.getElementById('turn-global-indicator').innerText = `Хід: ${activeCorp ? activeCorp.name : '...'}`;
            
            var panel = document.getElementById('action-workspace-card');
            var primaryBtn = document.getElementById('btn-hub-primary-action');
            var passBtn = document.getElementById('btn-hub-secondary-pass');
            var clickableArea = document.getElementById('dice-clickable-area');

            panel.style.display = 'none';
            clickableArea.style.pointerEvents = 'none';
            document.getElementById('dice-status-subtext').innerText = "ОЧІКУВАННЯ ХОДУ";
            document.getElementById('dice-status-subtext').style.color = 'var(--text-muted)';

            if(activeId === App.State.myId) {
                if(r.pendingAction) {
                    panel.style.display = 'block';
                    passBtn.style.display = 'none';
                    
                    var targetTile = GameConfig.mapData[r.pendingAction.tileId];
                    
                    if(r.pendingAction.type === 'buy') {
                        primaryBtn.innerText = `Придбати ${targetTile.name} ($${targetTile.price})`;
                        primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction(); };
                    } else if(r.pendingAction.type === 'rent') {
                        var rentCost = App.Gameplay.calculateRentFormula(targetTile, r.cells[targetTile.id], r);
                        primaryBtn.innerText = `Сплатити оренду ($${rentCost})`;
                        primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction(); };
                    } else if(r.pendingAction.type === 'tax') {
                        primaryBtn.innerText = `Сплатити мито ($${targetTile.cost})`;
                        primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction(); };
                    } else if(r.pendingAction.type === 'event') {
                        primaryBtn.innerText = `Відкрити інвест-картку`;
                        primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction(); };
                    }
                } else {
                    var myCurrentTile = GameConfig.mapData[activeCorp.pos];
                    var myServerTile = r.cells[activeCorp.pos];

                    if(myServerTile && myServerTile.owner === App.State.myId && myCurrentTile.type === 'property' && myServerTile.lvl < 6) {
                        panel.style.display = 'block';
                        passBtn.style.display = 'block';
                        var upgradeCost = Math.round(myCurrentTile.price * 0.6);
                        if(activeCorp.role === 'tycoon') upgradeCost = Math.round(upgradeCost * 0.7);

                        primaryBtn.innerText = `Збудувати філію ($${upgradeCost})`;
                        r.pendingAction = { type: 'build', tileId: myCurrentTile.id };
                        primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction(); };
                    }

                    clickableArea.style.pointerEvents = 'auto';
                    document.getElementById('dice-status-subtext').innerText = "👉 ВАШ ХІД! КЛИКНІТЬ";
                    document.getElementById('dice-status-subtext').style.color = activeCorp.color;
                }
            }

            var logsContainer = document.getElementById('terminal-log-target');
            if(r.logs) {
                logsContainer.innerHTML = r.logs.map(function(l) {
                    return `<div class="log-line ${l.type}">${l.text}</div>`;
                }).reverse().join('');
            }
        }
    }
};
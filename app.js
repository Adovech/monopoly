var App = {
    State: {
        roomId: null,
        myId: null,
        roomData: null,
        localRolling: false,
        gridRendered: false,
        lastTurnIndex: -1
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

        executeBusinessAction: function(forcedType, customValue) {
            var r = App.State.roomData;
            var act = r.pendingAction;
            
            var currentType = forcedType || (act ? act.type : null);
            if (!currentType) return;

            var me = r.players[App.State.myId];
            var tile = GameConfig.mapData[act ? act.tileId : me.pos];
            var serverTile = r.cells[act ? act.tileId : me.pos];
            var logLength = r.logs ? r.logs.length : 0;

            var updates = {};

            if(currentType === "buy") {
                if(me.cash < tile.price) return alert("Брак коштів для покупки активу!");
                
                updates['/players/' + App.State.myId + '/cash'] = me.cash - tile.price;
                updates['/cells/' + act.tileId + '/owner'] = App.State.myId;
                if(tile.type === "property") updates['/cells/' + act.tileId + '/lvl'] = 1;
                
                updates['/logs/' + logLength] = { type: "good", text: `💼 ${me.name} придбав актив: ${tile.name} за $${tile.price}.` };
                updates['/pendingAction'] = null;
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            } 
            else if(currentType === "pass_buy") {
                updates['/logs/' + logLength] = { type: "warn", text: `🏳️ ${me.name} вирішив не купувати ${tile.name} та зберіг ліквідність.` };
                updates['/pendingAction'] = null;
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            }
            else if(currentType === "build") {
                var buildCost = Math.round(tile.price * 0.6);
                if(me.role === "tycoon") buildCost = Math.round(buildCost * 0.7);

                if(me.cash < buildCost) return alert("Брак ліквідності для модернізації!");

                updates['/players/' + App.State.myId + '/cash'] = me.cash - buildCost;
                updates['/cells/' + tile.id + '/lvl'] = serverTile.lvl + 1;
                updates['/logs/' + logLength] = { 
                    type: "good", 
                    text: `🏢 ${me.name} модернізує ${tile.name}. Рівень підвищено до ${serverTile.lvl + 1}.` 
                };
                updates['/pendingAction'] = null;
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            } 
            else if(currentType === "rent") {
                var hostCorp = r.players[serverTile.owner];
                var finalRent = App.Gameplay.calculateRentFormula(tile, serverTile, r);

                // ПЕРЕВІРКА: якщо не вистачає грошей на оренду
                if (me.cash < finalRent) {
                    var totalAssetsValue = App.Gameplay.getAssetsTotalSellValue(App.State.myId);
                    
                    if (me.cash + totalAssetsValue >= finalRent) {
                        // Якщо майна вистачає для покриття, змушуємо продавати через інтерфейс
                        alert(`🚨 Недостатньо грошей для сплати оренди ($${finalRent})! У вас є $${me.cash}. Виберіть компанію для продажу в банк за 50% вартості.`);
                        return;
                    } else {
                        // Повне банкрутство: продається все, залишок віддається власнику, гравець вибуває
                        alert(`💀 Жорстке банкрутство! Навіть продаж усіх компаній не покриє оренду $${finalRent}. Ви вибуваєте з гри.`);
                        
                        var cashFromAllSales = totalAssetsValue;
                        var finalCompensation = me.cash + cashFromAllSales;
                        
                        updates['/players/' + serverTile.owner + '/cash'] = hostCorp.cash + finalCompensation;
                        updates['/logs/' + logLength] = { 
                            type: "alert", 
                            text: `💀 КРАХ: ${me.name} збанкрутував! Усі його фірми ліквідовані. Власник ${hostCorp.name} отримав останню компенсацію у розмірі $${finalCompensation}.` 
                        };
                        
                        App.Gameplay.triggerAbsoluteLiquidation(App.State.myId, updates);
                        db.ref('rooms/' + App.State.roomId).update(updates);
                        return;
                    }
                }

                // Звичайна сплата оренди, якщо грошей достатньо
                updates['/players/' + App.State.myId + '/cash'] = me.cash - finalRent;
                updates['/players/' + serverTile.owner + '/cash'] = hostCorp.cash + finalRent;
                updates['/logs/' + logLength] = { 
                    type: "alert", 
                    text: `⚠️ Оренда: ${me.name} виплачує $${finalRent} гравцю ${hostCorp.name}.` 
                };

                updates['/pendingAction'] = { type: "buyout_proposal", tileId: act.tileId, actor: App.State.myId, price: Math.round(tile.price * 1.25) };
                db.ref('rooms/' + App.State.roomId).update(updates);
            } 
            else if(currentType === "sell_asset_emergency") {
                var targetTileId = customValue;
                var targetTile = GameConfig.mapData[targetTileId];
                var refund = Math.round(targetTile.price * 0.5);

                updates['/players/' + App.State.myId + '/cash'] = me.cash + refund;
                updates['/cells/' + targetTileId + '/owner'] = "";
                updates['/cells/' + targetTileId + '/lvl'] = 0;
                updates['/logs/' + logLength] = { 
                    type: "warn", 
                    text: `⚖️ Екстрена ліквідація: ${me.name} продав банку фірму ${targetTile.name} за $${refund} для покриття боргів.` 
                };
                db.ref('rooms/' + App.State.roomId).update(updates);
            }
            else if(currentType === "send_buyout") {
                var offer = parseInt(customValue);
                if(isNaN(offer) || offer <= 0) return alert("Введіть коректну суму!");
                if(me.cash < offer) return alert("У вас немає стільки грошей для викупу!");

                updates['/pendingAction'] = {
                    type: "buyout_decision",
                    tileId: act.tileId,
                    actor: act.actor,
                    price: offer
                };
                updates['/logs/' + logLength] = { 
                    type: "sys", 
                    text: `💰 ${me.name} пропонує викупити ${tile.name} за $${offer}!` 
                };
                db.ref('rooms/' + App.State.roomId).update(updates);
            }
            else if(currentType === "accept_buyout") {
                var buyer = r.players[act.actor];
                var seller = r.players[serverTile.owner];

                updates['/players/' + act.actor + '/cash'] = buyer.cash - act.price;
                updates['/players/' + serverTile.owner + '/cash'] = seller.cash + act.price;
                updates['/cells/' + act.tileId + '/owner'] = act.actor;
                
                updates['/logs/' + logLength] = { 
                    type: "good", 
                    text: `🤝 Угода відбулася! ${buyer.name} викупив ${tile.name} у ${seller.name} за $${act.price}!` 
                };
                updates['/pendingAction'] = null;
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            }
            else if(currentType === "decline_buyout") {
                var buyer = r.players[act.actor];
                updates['/logs/' + logLength] = { 
                    type: "warn", 
                    text: `❌ ${me.name} відхилив пропозицію викупу фірми ${tile.name}.` 
                };
                updates['/pendingAction'] = { type: "buyout_proposal", tileId: act.tileId, actor: act.actor, price: Math.round(act.price * 1.15) };
                db.ref('rooms/' + App.State.roomId).update(updates);
            }
            else if(currentType === "cancel_buyout") {
                updates['/logs/' + logLength] = { type: "warn", text: `🏳️ ${me.name} відмовився від подальших торгів.` };
                updates['/pendingAction'] = null;
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            }
            else if(currentType === "tax") {
                if (me.cash < tile.cost) {
                    alert("Немає коштів на сплату податків! Продайте майно.");
                    return;
                }
                updates['/players/' + App.State.myId + '/cash'] = me.cash - tile.cost;
                updates['/logs/' + logLength] = { type: "alert", text: `🏛️ Податки: ${me.name} сплачує в бюджет $${tile.cost}.` };
                updates['/pendingAction'] = null;
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            } 
            else if(currentType === "event") {
                var randomCard = GameConfig.chanceCards[Math.floor(Math.random() * GameConfig.chanceCards.length)];
                var calculatedCash = me.cash;

                if(randomCard.type === "gift") calculatedCash += randomCard.sum;
                if(randomCard.type === "fine") {
                    if (me.cash < randomCard.sum) {
                        alert(`Штраф за карткою подій складає $${randomCard.sum}. Продайте майно, щоб вийти в плюс!`);
                        return;
                    }
                    calculatedCash -= randomCard.sum;
                }

                updates['/players/' + App.State.myId + '/cash'] = calculatedCash;
                updates['/logs/' + logLength] = { type: "warn", text: `📜 ПОДІЯ: ${randomCard.text}` };
                updates['/pendingAction'] = null;
                App.Gameplay.nextTurn(updates);
                db.ref('rooms/' + App.State.roomId).update(updates);
            }
        },

        getAssetsTotalSellValue: function(playerId) {
            var sum = 0;
            var r = App.State.roomData;
            GameConfig.mapData.forEach(function(tile) {
                if(r.cells[tile.id] && r.cells[tile.id].owner === playerId) {
                    sum += Math.round(tile.price * 0.5);
                }
            });
            return sum;
        },

        triggerAbsoluteLiquidation: function(playerId, updates) {
            GameConfig.mapData.forEach(function(tile) {
                if(App.State.roomData.cells[tile.id].owner === playerId) {
                    updates['/cells/' + tile.id + '/owner'] = "";
                    updates['/cells/' + tile.id + '/lvl'] = 0;
                }
            });
            var updatedOrder = App.State.roomData.order.filter(function(id) { return id !== playerId; });
            updates['/order'] = updatedOrder;
            updates['/players/' + playerId] = null;
            updates['/pendingAction'] = null;
            App.Gameplay.nextTurn(updates);
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
            if(!serverTile || !serverTile.owner) return 0;
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
                    <div class="cell-price-tag" id="price-tag-${tile.id}">${tile.price ? '$' + tile.price : (tile.cost ? '$' + tile.cost : '')}</div>
                    <div class="cell-tokens-tray" id="tray-box-${tile.id}"></div>
                `;
                container.appendChild(node);
            });
            App.State.gridRendered = true;
        },

        getDiceSymbol: function(n) {
            return { 1: "⚀", 2: "⚁", 3: "⚂", 4: "⚃", 5: "⚄", 6: "⚅" }[n] || "⚀";
        },

        triggerTurnAnimation: function(playerName) {
            var flash = document.createElement('div');
            flash.className = "turn-flash-announcement";
            flash.innerHTML = `<div>🏢 ХІД КОРПОРАЦІЇ</div><div class="turn-flash-name">${playerName}</div>`;
            document.body.appendChild(flash);
            setTimeout(function() { flash.remove(); }, 2000);
        },

        syncRealtimeData: function() {
            if(!App.State.gridRendered) App.UI.buildLayoutMatrix();

            var r = App.State.roomData;
            var activeId = r.order[r.turnIndex];
            var activeCorp = r.players[activeId];

            if(r.turnIndex !== App.State.lastTurnIndex && activeCorp) {
                App.State.lastTurnIndex = r.turnIndex;
                App.UI.triggerTurnAnimation(activeCorp.name);
            }

            // Динамічний рендеринг власників, рівнів та оновлення поточної ціни ОРЕНДИ на полі
            GameConfig.mapData.forEach(function(tile) {
                var serverTile = r.cells[tile.id];
                var tray = document.getElementById(`tray-box-${tile.id}`);
                if(tray) tray.innerHTML = "";

                var label = document.getElementById(`owner-box-${tile.id}`);
                var lvlContainer = document.getElementById(`lvl-box-${tile.id}`);
                var priceTag = document.getElementById(`price-tag-${tile.id}`);

                if(serverTile && serverTile.owner) {
                    var ownerMeta = r.players[serverTile.owner];
                    if(label && ownerMeta) {
                        label.innerText = ownerMeta.name.substring(0, 5) + '.';
                        label.style.background = ownerMeta.color;
                        label.style.color = "#000";
                    }

                    // Динамічне відображення поточної вартості оренди замість вартості покупки
                    if(priceTag && (tile.type === 'property' || tile.type === 'utility')) {
                        var dynamicRent = App.Gameplay.calculateRentFormula(tile, serverTile, r);
                        priceTag.innerText = `Оренда: $${dynamicRent}`;
                        priceTag.style.color = "#ef4444"; // Підсвітимо червоним для наочності
                    }

                    if(lvlContainer && tile.type === 'property') {
                        lvlContainer.innerHTML = "";
                        if(serverTile.lvl === 6) {
                            lvlContainer.innerHTML = `<div class="infrastructure-hotel"></div>`;
                        } else {
                            for(var i = 0; i < serverTile.lvl; i++) {
                                lvlContainer.innerHTML += `<div class="infrastructure-house"></div>`;
                            }
                        }
                    }
                } else {
                    if(label) label.innerText = "";
                    if(lvlContainer) lvlContainer.innerHTML = "";
                    if(priceTag) priceTag.innerText = tile.price ? '$' + tile.price : (tile.cost ? '$' + tile.cost : '');
                    if(priceTag) priceTag.style.color = "";
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

            // Екстрена перевірка для будь-якого гравця на його ходу: можливість розпродати майно
            if (activeId === App.State.myId && r.pendingAction) {
                var currentMe = r.players[App.State.myId];
                var currentTile = GameConfig.mapData[r.pendingAction.tileId];
                
                var costToPay = 0;
                if (r.pendingAction.type === 'rent') {
                    costToPay = App.Gameplay.calculateRentFormula(currentTile, r.cells[currentTile.id], r);
                } else if (r.pendingAction.type === 'tax') {
                    costToPay = currentTile.cost;
                }

                // Якщо борг перевищує кеш, додаємо спец-панель для розпродажу майна прямо зараз
                if (costToPay > 0 && currentMe.cash < costToPay) {
                    panel.style.display = 'block';
                    primaryBtn.innerText = `⚠️ Ліквідувати активи (Треба: $${costToPay}, Кеш: $${currentMe.cash})`;
                    primaryBtn.style.opacity = '1';
                    primaryBtn.style.pointerEvents = 'auto';
                    
                    primaryBtn.onclick = function() {
                        // Фільтруємо компанії, якими володіє поточний гравець
                        var myProperties = GameConfig.mapData.filter(function(tile) {
                            return r.cells[tile.id] && r.cells[tile.id].owner === App.State.myId;
                        });

                        if (myProperties.length === 0) {
                            alert("У вас немає майна для продажу!");
                            return;
                        }

                        var listString = myProperties.map(function(t) {
                            return `ID [${t.id}] : ${t.name} (Повернення: $${Math.round(t.price * 0.5)})`;
                        }).join('\n');

                        var chosenId = prompt(`Введіть ID компанії для продажу банку:\n\n${listString}`);
                        if (chosenId !== null && r.cells[chosenId] && r.cells[chosenId].owner === App.State.myId) {
                            App.Gameplay.executeBusinessAction('sell_asset_emergency', chosenId);
                        } else if(chosenId !== null) {
                            alert("Некоректний ID фірми!");
                        }
                    };
                    
                    passBtn.style.display = 'none';
                    return; 
                }
            }

            // Очікування рішення щодо викупу від іншого гравця
            if (r.pendingAction && r.pendingAction.type === 'buyout_decision') {
                var targetTile = GameConfig.mapData[r.pendingAction.tileId];
                var currentOwner = r.cells[targetTile.id].owner;

                if (currentOwner === App.State.myId) {
                    panel.style.display = 'block';
                    passBtn.style.display = 'block';
                    
                    primaryBtn.style.opacity = '1';
                    primaryBtn.style.pointerEvents = 'auto';
                    primaryBtn.innerText = `Прийняти викуп за $${r.pendingAction.price}`;
                    primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction('accept_buyout'); };

                    passBtn.innerText = "Відхилити пропозицію";
                    passBtn.onclick = function() { App.Gameplay.executeBusinessAction('decline_buyout'); };
                } else {
                    panel.style.display = 'block';
                    primaryBtn.innerText = "Очікування відповіді щодо викупу...";
                    primaryBtn.style.opacity = '0.5';
                    primaryBtn.style.pointerEvents = 'none';
                    passBtn.style.display = 'none';
                }
                return; 
            }

            // Стандартна логіка активного ходу
            if (activeId === App.State.myId) {
                if (r.pendingAction && r.pendingAction.type !== 'build') {
                    panel.style.display = 'block';
                    passBtn.style.display = 'none';
                    
                    var targetTile = GameConfig.mapData[r.pendingAction.tileId];
                    
                    if (r.pendingAction.type === 'buy') {
                        var canAfford = r.players[App.State.myId].cash >= targetTile.price;
                        
                        if (canAfford) {
                            primaryBtn.innerText = `Придбати ${targetTile.name} ($${targetTile.price})`;
                            primaryBtn.style.opacity = '1';
                            primaryBtn.style.pointerEvents = 'auto';
                            primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction(); };
                        } else {
                            primaryBtn.innerText = `Брак коштів ($${targetTile.price})`;
                            primaryBtn.style.opacity = '0.5';
                            primaryBtn.style.pointerEvents = 'none';
                        }

                        passBtn.style.display = 'block';
                        passBtn.innerText = "Відмовитися від покупки";
                        passBtn.onclick = function() { App.Gameplay.executeBusinessAction('pass_buy'); };

                    } else if (r.pendingAction.type === 'rent') {
                        var rentCost = App.Gameplay.calculateRentFormula(targetTile, r.cells[targetTile.id], r);
                        primaryBtn.innerText = `Сплатити оренду ($${rentCost})`;
                        primaryBtn.style.opacity = '1';
                        primaryBtn.style.pointerEvents = 'auto';
                        primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction(); };

                    } else if (r.pendingAction.type === 'buyout_proposal') {
                        var currentOffer = r.pendingAction.price;
                        primaryBtn.innerText = `Запропонувати викуп за $${currentOffer}`;
                        primaryBtn.style.opacity = '1';
                        primaryBtn.style.pointerEvents = 'auto';
                        primaryBtn.onclick = function() { 
                            var customPrice = prompt(`Введіть вашу суму викупу (мінімальна ціна: $${currentOffer}):`, currentOffer);
                            if(customPrice) App.Gameplay.executeBusinessAction('send_buyout', customPrice);
                        };

                        passBtn.style.display = 'block';
                        passBtn.innerText = "Завершити хід (Без викупу)";
                        passBtn.onclick = function() { App.Gameplay.executeBusinessAction('cancel_buyout'); };

                    } else if (r.pendingAction.type === 'tax') {
                        primaryBtn.innerText = `Сплатити мито ($${targetTile.cost})`;
                        primaryBtn.style.opacity = '1';
                        primaryBtn.style.pointerEvents = 'auto';
                        primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction(); };
                    } else if (r.pendingAction.type === 'event') {
                        primaryBtn.innerText = `Відкрити інвест-картку`;
                        primaryBtn.style.opacity = '1';
                        primaryBtn.style.pointerEvents = 'auto';
                        primaryBtn.onclick = function() { App.Gameplay.executeBusinessAction(); };
                    }
                } else {
                    clickableArea.style.pointerEvents = 'auto';
                    document.getElementById('dice-status-subtext').innerText = "👉 ВАШ ХІД! КЛИКНІТЬ";
                    document.getElementById('dice-status-subtext').style.color = r.players[App.State.myId].color;

                    var myCurrentTile = GameConfig.mapData[r.players[App.State.myId].pos];
                    var myServerTile = r.cells[r.players[App.State.myId].pos];

                    if (myServerTile && myServerTile.owner === App.State.myId && myCurrentTile.type === 'property' && myServerTile.lvl < 6) {
                        panel.style.display = 'block';
                        passBtn.style.display = 'block';
                        
                        var upgradeCost = Math.round(myCurrentTile.price * 0.6);
                        if (r.players[App.State.myId].role === 'tycoon') upgradeCost = Math.round(upgradeCost * 0.7);

                        primaryBtn.innerText = `Збудувати філію ($${upgradeCost})`;
                        primaryBtn.style.opacity = '1';
                        primaryBtn.style.pointerEvents = 'auto';
                        primaryBtn.onclick = function() { 
                            r.pendingAction = { type: 'build', tileId: myCurrentTile.id };
                            App.Gameplay.executeBusinessAction(); 
                        };
                        
                        passBtn.innerText = "Сховати панель розбудови";
                        passBtn.onclick = function() { panel.style.display = 'none'; };
                    }
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
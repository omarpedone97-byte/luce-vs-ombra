/* =========================================================================
   SERVER — Luce vs Ombra
   ---------------------------------------------------------------------
   Cosa fa:
   1. Si collega alla tua live TikTok vera (solo con lo username, niente
      password) tramite la libreria tiktok-live-connector.
   2. Ascolta i commenti in chat: se qualcuno scrive "luce" o "ombra",
      lo registra in quella squadra per tutta la live.
   3. Ascolta i regali veri: guarda che squadra ha scelto chi lo manda,
      calcola il valore in coin, e lo spedisce al gioco (index.html)
      tramite WebSocket in tempo reale.
   4. Serve anche il gioco stesso come pagina web, così TikTok LIVE
      Studio può caricarlo con un solo link.
   ========================================================================= */

const express = require('express');
const path = require('path');
const { WebSocketServer } = require('ws');
const { TikTokLiveConnection, WebcastEvent } = require('tiktok-live-connector');

// ---------------------------------------------------------------
// CONFIGURAZIONE — cambia qui il tuo username TikTok (senza @)
// Meglio ancora: impostalo come variabile d'ambiente TIKTOK_USERNAME
// nel pannello ".env" di Glitch, così non è scritto nel codice.
// ---------------------------------------------------------------
const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME || 'INSERISCI_QUI_IL_TUO_USERNAME';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = app.listen(process.env.PORT || 3000, () => {
  console.log('Server avviato sulla porta ' + (process.env.PORT || 3000));
});

// ---------------------------------------------------------------
// WEBSOCKET — il gioco (index.html) si collega qui per ricevere
// gli eventi in tempo reale
// ---------------------------------------------------------------
const wss = new WebSocketServer({ server });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Overlay collegato. Client attivi:', clients.size);
  ws.on('close', () => clients.delete(ws));
});

function broadcast(payload){
  const msg = JSON.stringify(payload);
  clients.forEach(ws => {
    if(ws.readyState === ws.OPEN) ws.send(msg);
  });
}

// ---------------------------------------------------------------
// ASSEGNAZIONE SQUADRA — chi scrive "luce" o "ombra" in chat
// viene ricordato per tutta la sessione (si azzera se riavvii il server)
// ---------------------------------------------------------------
const teamAssignments = {};

function assignTeamFromComment(uniqueId, comment){
  const text = (comment || '').toLowerCase();
  if(text.includes('luce')) teamAssignments[uniqueId] = 'luce';
  else if(text.includes('ombra')) teamAssignments[uniqueId] = 'ombra';
}

function getTeamFor(uniqueId){
  if(teamAssignments[uniqueId]) return teamAssignments[uniqueId];
  // Se non ha mai scelto, lo assegniamo a caso e lo ricordiamo,
  // così i suoi prossimi regali contano sempre per lo stesso lato.
  const team = Math.random() < 0.5 ? 'luce' : 'ombra';
  teamAssignments[uniqueId] = team;
  return team;
}

// ---------------------------------------------------------------
// CONNESSIONE A TIKTOK LIVE
// ---------------------------------------------------------------
const tiktok = new TikTokLiveConnection(TIKTOK_USERNAME);

tiktok.connect()
  .then(state => console.log('Collegato alla live! roomId:', state.roomId))
  .catch(err => console.error('Impossibile collegarsi. Sei live su TikTok in questo momento?', err));

tiktok.on(WebcastEvent.CHAT, data => {
  const uniqueId = data.user?.uniqueId || data.uniqueId || 'utente';
  const comment = data.comment || '';
  assignTeamFromComment(uniqueId, comment);
});

tiktok.on(WebcastEvent.GIFT, data => {
  // I regali "a streak" (giftType 1) arrivano più volte mentre l'utente
  // continua a mandarli di fila. Contiamo solo quando la streak finisce,
  // per non conteggiare lo stesso regalo decine di volte.
  const isStreakable = data.giftType === 1;
  if(isStreakable && data.repeatEnd !== true) return;

  const uniqueId = data.user?.uniqueId || data.uniqueId || 'spettatore';
  const giftName = data.gift?.name || data.giftName || data.giftId || 'Regalo';
  const diamondsPerItem = data.gift?.diamondCount ?? data.diamondCount ?? 1;
  const repeatCount = data.repeatCount || 1;
  const coinValue = diamondsPerItem * repeatCount;

  const team = getTeamFor(uniqueId);

  console.log(`[GIFT] ${uniqueId} -> ${team} : ${giftName} (${coinValue} coin)`);

  broadcast({
    type: 'gift',
    team,
    coinValue,
    giftName,
    username: uniqueId
  });
});

tiktok.on(WebcastEvent.DISCONNECTED, () => {
  console.log('Disconnesso dalla live. In attesa di riconnessione...');
});

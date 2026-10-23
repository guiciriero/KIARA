// Cena animada em pixel art: o mini Shih Tzu pedalando uma bicicleta que gera
// energia (cabo + faÃ­scas) para um computador CRT mostrando "LIVE ON".
// Sempre voltada para a DIREITA; fundo transparente ('.').

/** Largura de cada frame em pixels. */
export const SCENE_W = 64;
/** Altura de cada frame em pixels. */
export const SCENE_H = 20;
/** Quadros por segundo do loop. */
export const SCENE_FPS = 10;

/** Cada caractere (exceto '.') mapeia para uma cor CSS. '.' = transparente. */
export const SCENE_PALETTE: Readonly<Record<string, string>> = {
  w: '#f8fafc', // pelagem branca
  s: '#cbd5e1', // sombra da pelagem / gabinete claro
  a: '#d97706', // caramelo (orelhas/manchas)
  f: '#f59e0b', // caramelo claro
  m: '#78350f', // marrom escuro das orelhas
  n: '#0f172a', // nariz/boca / fundo da tela
  e: '#1e1b4b', // olho
  c: '#6366f1', // coleira/laÃ§o indigo
  t: '#38bdf8', // medalha / texto da tela
  l: '#f43f5e', // lÃ­ngua
  g: '#475569', // aÃ§o escuro (pneus, pedais)
  h: '#94a3b8', // aÃ§o claro (raios, quadro, gabinete)
  k: '#64748b', // cabo / sombra do gabinete
  y: '#facc15', // energia (amarelo)
  i: '#bae6fd', // texto da tela brilhando
  o: '#164e63', // brilho na borda da tela
  r: '#ef4444', // LED vermelho
};

/**
 * Frames do loop (8). Cada frame: SCENE_H strings de exatamente SCENE_W caracteres.
 * Pedalada, raios e pulsos no cabo fecham o ciclo (Ãºltimo frame -> primeiro).
 */
export const SCENE_FRAMES: readonly (readonly string[])[] = [
  [
    '...........cc.cc................................khhhhhhhhhk.....',
    '...........ccccc............................sssssssssssssssssss.',
    '..........swwwwws..........................shhooooooooooooooohhk',
    '.........swaawwwws.........................shotnnntttntntntttohk',
    '........swaaawwwwws........................shotnnnntnntntntnnohk',
    '........mmaawwwwewws.......................shotnnnntnntntnttnohk',
    '..aa....mmaawwwwewws.......................shotnnnntnntntntnnohk',
    '.swws...mmaawwwwwwwn.......................shotttntttnntnntttohk',
    'swwwws..mmmawwwwnnws.......................shonnnnnnnnnnnnnnnohk',
    'swwwws...mmmswwwlws........................shonnntttntnntnnnnohk',
    '.swwwsgg.mmm.sssss.....gggg................shonnntntnttntnnnnohk',
    '..s.wwwwgcccccccc....gwwwhggg..............shonnntntntnttnnnnohk',
    '..gwwwwwwwwwwwwtws.wwwssgh..g....y.........shonnntntntnntnnnnohk',
    '.ggwwwwwwwwwwwwwwwwsss.hhh..gghhh..........shonnntttntnntnnnnohk',
    '.ghssssswwwwwwwwssshhhhhhhhhhghyg..........shhooooooooooooooohhk',
    '.ghhhgggggggh..wwhh.ghhhhhhhhghyy.w........shhkkkkkhhhhhhhhhrhhk',
    '.gg..hh..ggggggww...gg..hh..ggggg...........kkkkkkkkkkkkkkkkkkk.',
    '..g..hh..g.....ggw...g..hh..g..k............sssssssssssssssssss.',
    '..ggghhggg.....hhh...ggghhggg..wkkkkkkkykkkkhhhhggggggghnwhhhhh.',
    '....gggg...............gggg.................kkkkkkkkkkkkkkkkkkk.',
  ],
  [
    '...........cc.cc................................khhhhhhhhhk.....',
    '...........ccccc............................sssssssssssssssssss.',
    '..........swwwwws..........................shhooooooooooooooohhk',
    '.........swaawwwws.........................shotnnntttntntntttohk',
    '........swaaawwwwws........................shotnnnntnntntntnnohk',
    '........mmaawwwwewws.......................shotnnnntnntntnttnohk',
    '..aa....mmaawwwwewws.......................shotnnnntnntntntnnohk',
    '.swws...mmaawwwwwwwn.......................shotttntttnntnntttohk',
    'swwwws..mmmawwwwnnws.......................shonnnnnnnnnnnnnnnohk',
    'swwwws...mmmswwwlws........................shonnntttntnntnnnnohk',
    '.swwwsgg.mmm.sssss.....gggg................shonnntntnttntnnnnohk',
    '..s.wwwwgcccccccc....gwww.ggg..............shonnntntntnttnnnnohk',
    '..gwwwwwwwwwwwwtws.wwwssghh.g..............shonnntntntnntnnnnohk',
    '.ggwwwwwwwwwwwwwwwwssshhhh..gghhh.y........shonnntttntnntnnnnohk',
    '.g.ssssswwwwssssssshhhhhhh...ghyg..........shhooooooooooooooohhk',
    '.g..hggggggwwwwhhhh.g...hhhh.ghwy..........shhkkkkkhhhhhhhhhrhhk',
    '.gg..h..hhhhhgw.....gg..h..hggggg...........kkkkkkkkkkkkkkkkkkk.',
    '..g.hh...g...gww.....g.hh...g..k............sssssssssssssssssss.',
    '..ggg..ggg....gw.....ggg..ggg..yywkkkkkkkykkhhhhggggggghnwhhhhh.',
    '....gggg.....hhh.......gggg.................kkkkkkkkkkkkkkkkkkk.',
  ],
  [
    '................................................khhhhhhhhhk.....',
    '...........cc.cc............................sssssssssssssssssss.',
    '...........ccccc...........................shhnnnnnnnnnnnnnnnhhk',
    '..........swwwwws..........................shntnnntttntntntttnhk',
    '.........swaawwwws.........................shntnnnntnntntntnnnhk',
    '..aa....swaaawwwwws........................shntnnnntnntntnttnnhk',
    '.swws...mmaawwwwewws.......................shntnnnntnntntntnnnhk',
    'swwwws..mmaawwwwewws.......................shntttntttnntnntttnhk',
    'swwwws..mmaawwwwwwwn.......................shnnnnnnnnnnnnnnnnnhk',
    '.swwws..mmmawwwwnnws.......................shnnnntttntnntnnnnnhk',
    '..swsggg.mmmswwwlws....gggg................shnnnntntnttntnnnnnhk',
    '..g.wwwwgmmm.sssss...gwww.ggg..............shnnnntntntnttnnnnnhk',
    '..gwwwwwhcccccccc..wwwssg..hg......w.......shnnnntntntnntnnnnnhk',
    '.ggwwwwwwwwwwwwtwwwsss.hh.h.gghhh..........shnnnntttntnntnnnnnhk',
    '.g.ssssswwwsssssssshhhh.hh...ghyg..........shhnnnnnnnnnnnnnnnhhk',
    '.g..hgggggwwww.hhhh.g...hh...ghyy..........shhkkkkkhhhhhhhhhghhk',
    '.gg.h..h.hhhwgh.....gg.h..h.gggggy..........kkkkkkkkkkkkkkkkkkk.',
    '..gh....hg..wg.......gh....hg..k............sssssssssssssssssss.',
    '..ggg..ggg..gw.......ggg..ggg..kkyywkkkkkkkyhhhhggggggghnwhhhhh.',
    '....gggg...hhh.........gggg.................kkkkkkkkkkkkkkkkkkk.',
  ],
  [
    '................................................khhhhhhhhhk.....',
    '...........cc.cc............................sssssssssssssssssss.',
    '...........ccccc...........................shhnnnnnnnnnnnnnnnhhk',
    '..........swwwwws..........................shntnnntttntntntttnhk',
    '.........swaawwwws.........................shntnnnntnntntntnnnhk',
    '..aa....swaaawwwwws........................shntnnnntnntntnttnnhk',
    '.swws...mmaawwwwewws.......................shntnnnntnntntntnnnhk',
    'swwwws..mmaawwwwewws.......................shntttntttnntnntttnhk',
    'swwwws..mmaawwwwwwwn.......................shnnnnnnnnnnnnnnnnnhk',
    '.swwws..mmmawwwwnnws.......................shnnnntttntnntnnnnnhk',
    '..swsggg.mmmswwwlws....gggg................shnnnntntnttntnnnnnhk',
    '..g.wwwwgmmm.sssss...gwww.ggg..............shnnnntntntnttnnnnnhk',
    '..gwwwww.cccccccc..wwwssg...g....w.........shnnnntntntnntnnnnnhk',
    '.ggwwwwwwwwwwwwtwwwsss.hh..hgghhh..........shnnnntttntnntnnnnnhk',
    '.g.ssssswwwwwsssssshhhh.hhhh.ghyg.y........shhnnnnnnnnnnnnnnnhhk',
    '.g.hhggggggww..ggsh.g.hhhh...ghwy..........shhkkkkkhhhhhhhhhghhk',
    '.ggh..h..hwwgggggg..ggh..h..ggggg...........kkkkkkkkkkkkkkkkkkk.',
    '..g...hh.ggg.........g...hh.g..k............sssssssssssssssssss.',
    '..ggg..gghhh.........ggg..ggg..kkkkyywkkkkkkhhhhggggggghnwhhhhh.',
    '....gggg...............gggg.................kkkkkkkkkkkkkkkkkkk.',
  ],
  [
    '...........cc.cc................................khhhhhhhhhk.....',
    '...........ccccc............................sssssssssssssssssss.',
    '..........swwwwws..........................shhooooooooooooooohhk',
    '.........swaawwwws.........................shotnnntttntntntttohk',
    '........swaaawwwwws........................shotnnnntnntntntnnohk',
    '........mmaawwwwewws.......................shotnnnntnntntnttnohk',
    '..aa....mmaawwwwewws.......................shotnnnntnntntntnnohk',
    '.swws...mmaawwwwwwwn.......................shotttntttnntnntttohk',
    'swwwws..mmmawwwwnnws.......................shonnnnnnnnnnnnnnnohk',
    'swwwws...mmmswwwlws........................shonnntttntnntnnnnohk',
    '.swwwsgg.mmm.sssss.....gggg................shonnntntnttntnnnnohk',
    '..s.wwwwgcccccccc....gwwwhggg..............shonnntntntnttnnnnohk',
    '..gwwwwwwwwwwwwtws.wwwssgh..g....y.........shonnntntntnntnnnnohk',
    '.ggwwwwwwwwwwwwwwwwsss.hhh..gghhh..........shonnntttntnntnnnnohk',
    '.ghssssswwwwssssssshhhhhhhhhhghyg..........shhooooooooooooooohhk',
    '.ghhhgggggggh..sshh.ghhhhhhhhghyy.w........shhkkkkkhhhhhhhhhrhhk',
    '.gg..hh..hhhgggss...gg..hh..ggggg...........kkkkkkkkkkkkkkkkkkk.',
    '..g..hh..g.....ggs...g..hh..g..k............sssssssssssssssssss.',
    '..ggghhggg.....ggg...ggghhggg..ykkkkkyywkkkkhhhhggggggghnwhhhhh.',
    '....gggg...............gggg.................kkkkkkkkkkkkkkkkkkk.',
  ],
  [
    '...........cc.cc................................khhhhhhhhhk.....',
    '...........ccccc............................sssssssssssssssssss.',
    '..........swwwwws..........................shhooooooooooooooohhk',
    '.........swaawwwws.........................shotnnntttntntntttohk',
    '........swaaawwwwws........................shotnnnntnntntntnnohk',
    '........mmaawwwwewws.......................shotnnnntnntntnttnohk',
    '..aa....mmaawwwwewws.......................shotnnnntnntntntnnohk',
    '.swws...mmaawwwwwwwn.......................shotttntttnntnntttohk',
    'swwwws..mmmawwwwnnws.......................shonnnnnnnnnnnnnnnohk',
    'swwwws...mmmswwwlws........................shonnntttntnntnnnnohk',
    '.swwwsgg.mmm.sssss.....gggg................shonnntntnttntnnnnohk',
    '..s.wwwwgcccccccc....gwww.ggg..............shonnntntntnttnnnnohk',
    '..gwwwwwwwwwwwwtws.wwwssghh.g..............shonnntntntnntnnnnohk',
    '.ggwwwwwwwwwgwwwwwwssshhhh..gghhh.y........shonnntttntnntnnnnohk',
    '.g.ssssswwshhhssssshhhhhhh...ghyg..........shhooooooooooooooohhk',
    '.g..hggggggssgshhhh.g...hhhh.ghwy..........shhkkkkkhhhhhhhhhrhhk',
    '.gg..h..hhhhhgs.....gg..h..hggggg...........kkkkkkkkkkkkkkkkkkk.',
    '..g.hh...g...gss.....g.hh...g..k............sssssssssssssssssss.',
    '..ggg..ggg....gs.....ggg..ggg..kkykkkkkyywkkhhhhggggggghnwhhhhh.',
    '....gggg.....ggg.......gggg.................kkkkkkkkkkkkkkkkkkk.',
  ],
  [
    '................................................khhhhhhhhhk.....',
    '...........cc.cc............................sssssssssssssssssss.',
    '...........ccccc...........................shhooooooooooooooohhk',
    '..........swwwwws..........................shoinnniiinininiiiohk',
    '.........swaawwwws.........................shoinnnninninininnohk',
    '..aa....swaaawwwwws........................shoinnnninnininiinohk',
    '.swws...mmaawwwwewws.......................shoinnnninninininnohk',
    'swwwws..mmaawwwwewws.......................shoiiiniiinninniiiohk',
    'swwwws..mmaawwwwwwwn.......................shonnnnnnnnnnnnnnnohk',
    '.swwws..mmmawwwwnnws.......................shonnniiininninnnnohk',
    '..swsggg.mmmswwwlws....gggg................shonnnininiininnnnohk',
    '..g.wwwwgmmm.sssss...gwww.ggg..............shonnninininiinnnnohk',
    '..gwwwwwhcccccccc..wwwssg..hg......w.......shonnninininninnnnohk',
    '.ggwwwwwwwwwwwwtwwwsss.hh.h.gghhh..........shonnniiininninnnnohk',
    '.g.ssssswwwsshhhssshhhh.hh...ghyg..........shhooooooooooooooohhk',
    '.g..hggggggssg.hhhh.g...hh...ghyy..........shhkkkkkhhhhhhhhhghhk',
    '.gg.h..h.hhhsgh.....gg.h..h.gggggy..........kkkkkkkkkkkkkkkkkkk.',
    '..gh....hg..sg.......gh....hg..k............sssssssssssssssssss.',
    '..ggg..ggg..gs.......ggg..ggg..kkkkykkkkkyywhhhhggggggghnwhhhhh.',
    '....gggg...ggg.........gggg.................kkkkkkkkkkkkkkkkkkk.',
  ],
  [
    '................................................khhhhhhhhhk.....',
    '...........cc.cc............................sssssssssssssssssss.',
    '...........ccccc...........................shhooooooooooooooohhk',
    '..........swwwwws..........................shoinnniiinininiiiohk',
    '.........swaawwwws.........................shoinnnninninininnohk',
    '..aa....swaaawwwwws........................shoinnnninnininiinohk',
    '.swws...mmaawwwwewws.......................shoinnnninninininnohk',
    'swwwws..mmaawwwwewws.......................shoiiiniiinninniiiohk',
    'swwwws..mmaawwwwwwwn.......................shonnnnnnnnnnnnnnnohk',
    '.swwws..mmmawwwwnnws.......................shonnniiininninnnnohk',
    '..swsggg.mmmswwwlws....gggg................shonnnininiininnnnohk',
    '..g.wwwwgmmm.sssss...gwww.ggg..............shonnninininiinnnnohk',
    '..gwwwww.cccccccc..wwwssg...g....w.........shonnninininninnnnohk',
    '.ggwwwwwwwwwwwwtwwwsss.hh..hgghhh..........shonnniiininninnnnohk',
    '.g.ssssswwwwssswwsshhhh.hhhh.ghyg.y........shhooooooooooooooohhk',
    '.g.hhggggggss..ggwh.g.hhhh...ghwy..........shhkkkkkhhhhhhhhhghhk',
    '.ggh..h..hssggghhh..ggh..h..ggggg...........kkkkkkkkkkkkkkkkkkk.',
    '..g...hh.ggg.........g...hh.g..k............sssssssssssssssssss.',
    '..ggg..ggggg.........ggg..ggg..kkkkkkykkkkkyhhhhggggggghnwhhhhh.',
    '....gggg...............gggg.................kkkkkkkkkkkkkkkkkkk.',
  ],
];

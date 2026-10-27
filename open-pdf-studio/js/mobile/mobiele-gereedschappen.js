// Gereedschappen in het menu van de mobiele werkbalk (#593).
//
// Tot #593 stuurde dat menu een 'set-tool'-event dat nergens werd opgevangen,
// en noemde het gereedschappen die niet bestaan ('underline', 'strikethrough',
// 'textSelect'): geen enkele knop deed iets. Elk item hier is een naam uit
// het gereedschapsregister (tools/tools/index.js) en wordt rechtstreeks met
// setTool() gekozen. Het label is een bestaande lintsleutel, dus vertaald in
// alle talen. Beide regels bewaakt mobiele-gereedschappen.test.mjs.

export const MOBIELE_GEREEDSCHAPPEN = Object.freeze([
  Object.freeze({ tool: 'select', label: 'home.select' }),
  Object.freeze({ tool: 'highlight', label: 'comment.highlight' }),
  Object.freeze({ tool: 'draw', label: 'comment.freehand' }),
  Object.freeze({ tool: 'textbox', label: 'comment.textBox' }),
  Object.freeze({ tool: 'comment', label: 'comment.note' }),
]);

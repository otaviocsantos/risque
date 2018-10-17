// Almost verbatim from Squire Constants.js
export class Ambient {

  static readonly DOCUMENT_POSITION_PRECEDING = 2; // Node.DOCUMENT_POSITION_PRECEDING
  static readonly ELEMENT_NODE = 1;                // Node.ELEMENT_NODE;
  static readonly TEXT_NODE = 3;                   // Node.TEXT_NODE;
  static readonly DOCUMENT_NODE = 9;               // Node.DOCUMENT_NODE;
  static readonly DOCUMENT_FRAGMENT_NODE = 11;     // Node.DOCUMENT_FRAGMENT_NODE;
  static readonly SHOW_ELEMENT = 1;                // NodeFilter.SHOW_ELEMENT;
  static readonly SHOW_TEXT = 4;                   // NodeFilter.SHOW_TEXT;

  static readonly START_TO_START = 0; // Range.START_TO_START
  static readonly START_TO_END = 1;   // Range.START_TO_END
  static readonly END_TO_END = 2;     // Range.END_TO_END
  static readonly END_TO_START = 3;   // Range.END_TO_START

  static readonly ZWS = '\u200B';

  static readonly ua = navigator.userAgent;

  static readonly isAndroid = /Android/.test(Ambient.ua);

  static readonly isIOS = /iP(?:ad|hone|od)/.test(Ambient.ua);

  static readonly isMac = /Mac OS X/.test(Ambient.ua);

  static readonly isWin = /Windows NT/.test(Ambient.ua);

  static readonly isGecko = /Gecko\//.test(Ambient.ua);

  static readonly isIElt11 = /Trident\/[456]\./.test(Ambient.ua);

  static readonly isPresto = navigator.userAgent.match(/Opera|OPR\//);

  static readonly isEdge = /Edge\//.test(Ambient.ua);

  static readonly isWebKit = !Ambient.isEdge && /WebKit\//.test(Ambient.ua);

  static readonly isIE = /Trident\/[4567]\./.test(Ambient.ua);

  static readonly ctrlKey = Ambient.isMac ? 'meta-' : 'ctrl-';

  static readonly useTextFixer = Ambient.isIElt11 || Ambient.isPresto;

  static readonly cantFocusEmptyTextNodes = Ambient.isIElt11 || Ambient.isWebKit;

  static readonly losesSelectionOnBlur = Ambient.isIElt11;

  static readonly canObserveMutations = typeof MutationObserver !== 'undefined';

  static readonly canWeakMap = typeof WeakMap !== 'undefined';

  // Use [^ \t\r\n] instead of \S so that nbsp does not count as white-space
  static readonly notWS = /[^ \t\r\n]/;

  // HTML classes definitions
  static readonly COLOR_CLASS = 'color';
  static readonly BACKGROUND_COLOR_CLASS = 'background-color';
  static readonly FONT_FAMILY_CLASS = 'font-family';
  static readonly FONT_SIZE_CLASS = 'font-size';
  static readonly LINE_HEIGHT_CLASS = 'line-height';
  static readonly classesCount = 5;
  // HTML classes definitions - end
}

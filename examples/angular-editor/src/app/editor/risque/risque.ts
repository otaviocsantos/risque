import { Ambient } from './ambient';
import { Noder } from './noder';
import { Ranger } from './ranger';
import { Clean } from './clean';
import { Clipboard } from './clipboard';
import { KeyHandlers } from './keyhandlers';
import { TreeWalker } from './tree-walker';

import { DOMPurify } from 'dompurify';

export class Risque {

  clean: Clean;
  _undoIndex: number;
  _undoStack;
  _undoStackLength: number;
  _isInUndoState: boolean;
  _ignoreChange: boolean;
  _ignoreAllChanges: boolean;

  _isFocused: boolean;

  _awaitingPaste: boolean;

  _mutation: MutationObserver;

  nodeCategoryCache: WeakMap<object, any>;

  root: Element;
  _root: HTMLElement;
  _doc: Document;
  doc: Document;
  _win;


  _myNoder: Noder;
  _config;

  _clipboard: Clipboard;

  startSelectionId = 'squire-selection-start';
  endSelectionId = 'squire-selection-end';
  _restoreSelection: boolean;
  _lastSelection;

  isShiftDown: boolean;

  _keyHandlers: KeyHandlers;

  customEvents = {
    pathChange: 1, select: 1, input: 1, undoStateChange: 1
  };

  tagAfterSplit = {
    DT: 'DD',
    DD: 'DT',
    LI: 'LI',
    PRE: 'PRE'
  };


  _events;
  _hasZWS: boolean;
  _lastAnchorNode;
  _lastFocusNode;
  _path: string;
  _willUpdatePath: boolean;

  linkRegExp = /\b((?:(?:ht|f)tps?:\/\/|www\d{0,3}[.]|[a-z0-9.\-]+[.][a-z]{2,}\/)(?:[^\s()<>]+|\([^\s()<>]+\))+(?:\((?:[^\s()<>]+|(?:\([^\s()<>]+\)))*\)|[^\s`!()\[\]{}:'".,<>?«»“”‘’]))|([\w\-.%+]+@(?:[\w\-]+\.)+[A-Z]{2,}\b)/i;

  constructor(root: HTMLElement, config) {

    this.clean = new Clean();
    const doc = root.ownerDocument;
    const win = doc.defaultView;

    this.doc = doc;


    this._win = win;
    this._doc = doc;
    this._root = root;
    this.root = root;

    this._events = {};

    this._isFocused = false;
    this._lastSelection = null;

    // IE loses selection state of iframe on blur, so make sure we
    // cache it just before it loses focus.
    if (Ambient.losesSelectionOnBlur) {
      this.addEventListener('beforedeactivate', this.getSelection);
    }

    this._hasZWS = false;

    this._lastAnchorNode = null;
    this._lastFocusNode = null;
    this._path = '';
    this._willUpdatePath = false;

    if ('onselectionchange' in doc) {
      this.addEventListener('selectionchange', this._updatePathOnEvent);
    } else {
      this.addEventListener('keyup', this._updatePathOnEvent);
      this.addEventListener('mouseup', this._updatePathOnEvent);
    }

    this._undoIndex = -1;
    this._undoStack = [];
    this._undoStackLength = 0;
    this._isInUndoState = false;
    this._ignoreChange = false;
    this._ignoreAllChanges = false;

    this._lastSelection = null;

    this._restoreSelection = false;

    this._clipboard = new Clipboard(this);

    if (Ambient.canObserveMutations) {
      this._mutation = new MutationObserver(mutations => {
        this._docWasChanged();
      });

      this._mutation.observe(this.root, {
        childList: true,
        attributes: true,
        characterData: true,
        subtree: true
      });
    } else {
      this.root.addEventListener('keyup', this._keyUpDetectChange);
    }

    // On blur, restore focus except if the user taps or clicks to focus a
    // specific point. Can't actually use click event because focus happens
    // before click, so use mousedown/touchstart
    this._restoreSelection = false;
    this.addEventListener('blur', this.enableRestoreSelection);
    this.addEventListener('mousedown', this.disableRestoreSelection);
    this.addEventListener('touchstart', this.disableRestoreSelection);
    this.addEventListener('focus', this.restoreSelection);

    // IE sometimes fires the beforepaste event twice; make sure it is not run
    // again before our after paste function is called.
    this._awaitingPaste = false;
    this.addEventListener(Ambient.isIElt11 ? 'beforecut' : 'cut', (event) => this._clipboard.onCut);
    this.addEventListener('copy', (event) => this._clipboard.onCopy);
    this.addEventListener('keydown', (event) => this._clipboard.monitorShiftKey);
    this.addEventListener('keyup', (event) => this._clipboard.monitorShiftKey(event));
    this.addEventListener(Ambient.isIElt11 ? 'beforepaste' : 'paste', (event) => this._clipboard.onPaste);
    this.addEventListener('drop', (event) => this._clipboard.onDrop);


    // Add key handlers
    this._keyHandlers = new KeyHandlers(this);

    // Opera does not fire keydown repeatedly.
    this.addEventListener(Ambient.isPresto ? 'keypress' : 'keydown', (event) => { this._keyHandlers.onKey(event); });


    // Override default properties
    this.config = config;

    // Fix IE<10's buggy implementation of Text#splitText.
    // If the split is at the end of the node, it doesn't insert the newly split
    // node into the document, and sets its value to undefined rather than ''.
    // And even if the split is not at the end, the original node is removed
    // from the document and replaced by another, rather than just having its
    // data shortened.
    // We used to feature test for this, but then found the feature test would
    // sometimes pass, but later on the buggy behaviour would still appear.
    // I think IE10 does not have the same bug, but it doesn't hurt to replace
    // its native fn too and then we don't need yet another UA category.
    if (Ambient.isIElt11) {
      Text.prototype.splitText = function (offset) {
        const afterSplit = this.ownerDocument.createTextNode(
          this.data.slice(offset)),
          next = this.nextSibling,
          parent = this.parentNode,
          toDelete = this.length - offset;
        if (next) {
          parent.insertBefore(afterSplit, next);
        } else {
          parent.appendChild(afterSplit);
        }
        if (toDelete) {
          this.deleteData(offset, toDelete);
        }
        return afterSplit;
      };
    }

    this.root.setAttribute('contenteditable', 'true');

    // Remove Firefox's built-in controls
    try {
      this.doc.execCommand('enableObjectResizing', false, 'false');
      this.doc.execCommand('enableInlineTableEditing', false, 'false');
    } catch (error) { }

    (this.root as any).__squire__ = this;

    // Need to register instance before calling setHTML, so that the fixCursor
    // function can lookup any default block tag options set.
    this.setHTML('');


    // console.log('Risque.constructor win', this._win);
  }

  mergeObjects(base, extras, mayOverride) {
    let prop, value;
    if (!base) {
      base = {};
    }
    if (extras) {
      for (prop in extras) {
        if (mayOverride || !(prop in base)) {
          value = extras[prop];
          base[prop] = (value && value.constructor === Object) ?
            this.mergeObjects(base[prop], value, mayOverride) :
            value;
        }
      }
    }
    return base;
  }

  set config(value: any) {

    value = this.mergeObjects({
      blockTag: 'DIV',
      blockAttributes: null,
      tagAttributes: {
        blockquote: null,
        ul: null,
        ol: null,
        li: null,
        a: null
      },
      leafNodeNames: Noder.leafNodeNames,
      undo: {
        documentSizeThreshold: -1, // -1 means no threshold
        undoLimit: -1 // -1 means no limit
      },
      isInsertedHTMLSanitized: true,
      isSetHTMLSanitized: true,
      sanitizeToDOMFragment:
        typeof DOMPurify !== 'undefined' && DOMPurify.isSupported ?
          this.sanitizeToDOMFragment : null

    }, value, true);

    // Users may specify block tag in lower case
    value.blockTag = value.blockTag.toUpperCase();

    this._config = value;

  }

  sanitizeToDOMFragment(html, isPaste, self) {

    const doc = self._doc;
    const frag = html ? DOMPurify.sanitize(html, {
      ALLOW_UNKNOWN_PROTOCOLS: true,
      WHOLE_DOCUMENT: false,
      RETURN_DOM: true,
      RETURN_DOM_FRAGMENT: true
    }) : null;
    return frag ? doc.importNode(frag, true) : doc.createDocumentFragment();
  }

  set content(val: string) {
    this.setHTML(val);
  }

  get content() {
    return this.getHTML();
  }

  createElement(tag, props?, children?) {

    return Noder.createElement(this._doc, tag, props, children);
  }

  createDefaultBlock(children?) {

    const config = this._config;
    return Noder.fixCursor(
      this.createElement(config.blockTag, config.blockAttributes, children),
      this._root
    );
  }

  didError(error) {
  }

  getDocument(): Document {

    return this._doc;
  }
  getRoot(): HTMLElement {

    return this._root;
  }

  modifyDocument(modificationCallback) {

    const mutation = this._mutation;
    if (mutation) {
      if (mutation.takeRecords().length) {
        this._docWasChanged();
      }
      mutation.disconnect();
    }

    this._ignoreAllChanges = true;
    modificationCallback();
    this._ignoreAllChanges = false;

    if (mutation) {
      mutation.observe(this._root, {
        childList: true,
        attributes: true,
        characterData: true,
        subtree: true
      });
      this._ignoreChange = false;
    }
  }

  // --- Events ---

  // Subscribing to these events won't automatically add a listener to the
  // document node, since these events are fired in a custom manner by the
  // editor code.

  fireEvent(type: string, event?) {
    // log.do(type);
    let handlers = this._events[type];
    let isFocused, l, obj;
    // UI code, especially modal views, may be monitoring for focus events and
    // immediately removing focus. In certain conditions, this can cause the
    // focus event to fire after the blur event, which can cause an infinite
    // loop. So we detect whether we're actually focused/blurred before firing.

    // console.log('fireEvent  type ', type);
    // console.log('fireEvent  this._root ', this._root);
    // console.log('fireEvent  this._doc.activeElement ', this._doc.activeElement);
    // console.log(' this._root === this._doc.activeElement ', this._root === this._doc.activeElement);

    if (/^(?:focus|blur)/.test(type)) {
      isFocused = this._root === this._doc.activeElement;
      if (type === 'focus') {
        if (!isFocused || this._isFocused) {
          return this;
        }
        this._isFocused = true;
      } else {
        if (isFocused || !this._isFocused) {
          return this;
        }
        this._isFocused = false;
      }
    }
    if (handlers) {
      if (!event) {
        event = {};
      }
      if (event.type !== type) {
        event.type = type;
      }
      // Clone handlers array, so any handlers added/removed do not affect it.
      handlers = handlers.slice();
      l = handlers.length;
      while (l--) {
        obj = handlers[l];
        try {
          if (obj.handleEvent) {
            obj.handleEvent(event);
          } else {
            obj.call(this, event);
          }
        } catch (error) {
          error.details = 'Squire: fireEvent error. Event type: ' + type;
          this.didError(error);
        }
      }
    }
    return this;
  }

  destroy() {

    const events = this._events;
    let type;

    for (type of Object.keys(events)) {
      this.removeEventListener(type);
    }
    if (this._mutation) {
      this._mutation.disconnect();
    }
    delete (this._root as any).__squire__;

    // Destroy undo stack
    this._undoIndex = -1;
    this._undoStack = [];
    this._undoStackLength = 0;
  }

  handleEvent(event) {

    this.fireEvent(event.type, event);
  }

  addEventListener(type, fn): Risque {

    let handlers = this._events[type];
    let target: HTMLElement | Document;
    target = this._root;
    if (!fn) {
      this.didError({
        name: 'Squire: addEventListener with null or undefined fn',
        message: 'Event type: ' + type
      });
      return this;
    }
    if (!handlers) {
      handlers = this._events[type] = [];
      if (!this.customEvents[type]) {
        if (type === 'selectionchange') {
          target = this._doc;
        }
        target.addEventListener(type, this, true);
      }
    }
    handlers.push(fn);
    return this;
  }

  removeEventListener(type, fn?) {

    const handlers = this._events[type];
    let target: HTMLElement | Document;
    target = this._root;
    let l;
    if (handlers) {
      if (fn) {
        l = handlers.length;
        while (l--) {
          if (handlers[l] === fn) {
            handlers.splice(l, 1);
          }
        }
      } else {
        handlers.length = 0;
      }
      if (!handlers.length) {
        delete this._events[type];
        if (!this.customEvents[type]) {
          if (type === 'selectionchange') {
            target = this._doc;
          }
          target.removeEventListener(type, this, true);
        }
      }
    }
    return this;
  }

  // --- Selection and Path ---

  _createRange(range, startOffset, endContainer?, endOffset?): Range {

    if (range instanceof this._win.Range) {
      return range.cloneRange();
    }
    const domRange = this._doc.createRange();
    domRange.setStart(range, startOffset);
    if (endContainer) {
      domRange.setEnd(endContainer, endOffset);
    } else {
      domRange.setEnd(range, startOffset);
    }
    return domRange;
  }

  getCursorPosition(range?: Range): ClientRect {

    if ((!range && !(range = this.getSelection())) ||
      !range.getBoundingClientRect) {
      return null;
    }
    // Get the bounding rect
    let rect = range.getBoundingClientRect();
    let node, parent;
    if (rect && !rect.top) {
      this._ignoreChange = true;
      node = this._doc.createElement('SPAN');
      node.textContent = Ambient.ZWS;
      Ranger.insertNodeInRange(range, node);
      rect = node.getBoundingClientRect();
      parent = node.parentNode;
      parent.removeChild(node);
      Noder.mergeInlines(parent, range);
    }
    return rect;
  }

  selectElement(klass?: string, tag?: string, order = 0) {

    // const range = this._doc.createRange();
    let referenceNode;
    if (typeof tag !== 'undefined') {
      referenceNode = this._doc.getElementsByTagName(tag).item(order);
    } else {
      referenceNode = this._doc.getElementsByClassName(klass).item(order);
    }
    // referenceNode = this._doc.getElementsByClassName(klass).item(order);
    // console.log('referenceNode',referenceNode);

    // range.selectNode(referenceNode);
    // console.log('range',range);
    // this.setSelection(range);

    if (this._win.getSelection) {

      const selection = this._win.getSelection();
      const range = this.doc.createRange();
      range.selectNodeContents(referenceNode);
      this.setSelection(range);
      selection.removeAllRanges();
      selection.addRange(range);
      return referenceNode;
    }
    return null;
  }

  selectTextOfElement(klass?: string, tag?: string, order = 0) {
    const element = this.selectElement(klass, tag, order);
    let result = null;
    if (element) {
      result = this.findFirstText(element);

      if (this._win.getSelection) {

        const selection = this._win.getSelection();
        const range = this.doc.createRange();
        range.selectNodeContents(result);
        this.setSelection(range);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    return element;
  }


  findFirstText(el) {
    for (let i = 0; i < el.childNodes.length; i++) {
      const curNode = el.childNodes[i];
      if (curNode.childNodes.length) {
        return this.findFirstText(curNode);
      } else
        if (curNode.nodeType === Node.TEXT_NODE && curNode.nodeValue.trim() !== '') {
          return curNode;
        }
    }
  }

  placeCaretInsideElement(klass?: string, tag?: string, order = 0) {
    let referenceNode;
    if (typeof tag !== 'undefined') {
      referenceNode = this._doc.getElementsByTagName(tag).item(order);
    } else {
      referenceNode = this._doc.getElementsByClassName(klass).item(order);
    }

    // this.blur(); //no difference
    // this.focus();

    const range = document.createRange();
    range.selectNodeContents(referenceNode);
    window.getSelection().addRange(range);
    // referenceNode.focus(); //no difference

  }

  setCaret(klass?: string, tag?: string, order = 0) {
    this._root.focus();
    let el;
    if (typeof tag !== 'undefined') {
      el = this._doc.getElementsByTagName(tag).item(order);
    } else {
      el = this._doc.getElementsByClassName(klass).item(order);
    }

    const range = this.doc.createRange();
    const sel = this._win.getSelection();

    // console.log(el.childNodes);
    // console.log(el.childNodes[0].childNodes[0]);

    range.setStart(el.childNodes[0].childNodes[0], 5);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    el.focus();
  }


  clearSelection() {
    const sel = this._win.getSelection ? this._win.getSelection() : 'selection' in this.doc ? this.doc['selection'] : null;
    if (sel) {
      if (sel.removeAllRanges) {
        sel.removeAllRanges();
      } else if (sel.empty) {
        sel.empty();
      }
    }
  }

  getCaretPosition() {
    let caretOffset = 0;
    let sel;
    if (typeof this._win.getSelection !== 'undefined') {
      sel = this._win.getSelection();
      if (sel.rangeCount > 0) {
        const range = this._win.getSelection().getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(this.root);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        caretOffset = preCaretRange.toString().length;
      }
    }
    return caretOffset;
  }

  _moveCursorTo(toStart) {

    const root = this._root,
      range = this._createRange(root, toStart ? 0 : root.childNodes.length);
    Ranger.moveRangeBoundariesDownTree(range);
    this.setSelection(range);
    return this;
  }

  moveCursorTo(pos) {
    this._root.focus();
    this.doc.getSelection().collapse(this._root, pos);
  }

  moveCursorToStart() {

    return this._moveCursorTo(true);
  }

  moveCursorToEnd() {

    return this._moveCursorTo(false);
  }

  getWindowSelection(self): Selection | null {

    return self._win.getSelection() || null;
    /*
    return self._win.getSelection
      ?
      self._win.getSelection()
      :
      self.doc.getSelection
        ?
        self.doc.getSelection()
        :
        self.doc['selection'].createRange().text ?
          self.doc['selection'].createRange().text
          :
          null;
          */
  }

  setSelection(range) {

    if (range) {
      this._lastSelection = range;
      // If we're setting selection, that automatically, and synchronously, // triggers a focus event. So just store the selection and mark it as
      // needing restore on focus.
      if (!this._isFocused) {
        this.enableRestoreSelection.call(this);
      } else if (Ambient.isAndroid && !this._restoreSelection) {
        // Android closes the keyboard on removeAllRanges() and doesn't
        // open it again when addRange() is called, sigh.
        // Since Android doesn't trigger a focus event in setSelection(),
        // use a blur/focus dance to work around this by letting the
        // selection be restored on focus.
        // Need to check for !this._restoreSelection to avoid infinite loop
        this.enableRestoreSelection.call(this);
        this.blur();
        this.focus();
      } else {
        // iOS bug: if you don't focus the iframe before setting the
        // selection, you can end up in a state where you type but the input
        // doesn't get directed into the contenteditable area but is instead
        // lost in a black hole. Very strange.
        if (Ambient.isIOS) {
          this._win.focus();
        }
        const sel = this.getWindowSelection(this);
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
    return this;
  }

  getSelection() {

    const sel = this.getWindowSelection(this);

    // console.log('Risque.getSelection sel: ', sel);
    // console.log('Risque.getSelection this._isFocused : ', this._isFocused);
    // console.log('Risque.getSelection sel.rangeCount: ', sel.rangeCount);

    const root = this._root;
    let selection, startContainer, endContainer, node;
    // If not focused, always rely on cached selection; another function may
    // have set it but the DOM is not modified until focus again
    if (this._isFocused && sel && sel.rangeCount) {
      // console.log('Risque.getSelection CASE 0: ');

      selection = sel.getRangeAt(0).cloneRange();
      startContainer = selection.startContainer;
      endContainer = selection.endContainer;
      // FF can return the selection as being inside an <img>. WTF?
      if (startContainer && Noder.isLeaf(startContainer)) {
        selection.setStartBefore(startContainer);
      }
      if (endContainer && Noder.isLeaf(endContainer)) {
        selection.setEndBefore(endContainer);
      }
    }
    if (selection &&
      Noder.isOrContains(root, selection.commonAncestorContainer)) {
      // log.do('Risque.getSelection CASE 1: ');
      this._lastSelection = selection;
    } else {
      // log.do('Risque.getSelection CASE 2: ');
      selection = this._lastSelection;
      node = selection.commonAncestorContainer;
      // Check the editor is in the live document; if not, the range has
      // probably been rewritten by the browser and is bogus
      if (!Noder.isOrContains(node.ownerDocument, node)) {
        selection = null;
      }
    }
    if (!selection) {
      // log.do('Risque.getSelection CASE 3: ');

      selection = this._createRange(root.firstChild, 0);
    }
    return selection;
  }

  enableRestoreSelection() {

    this._restoreSelection = true;
  }

  disableRestoreSelection() {
    // log.do('disableRestoreSelection');

    this._restoreSelection = false;
  }

  restoreSelection() {
    // log.do('restoreSelection');

    if (this._restoreSelection) {
      this.setSelection(this._lastSelection);
    }
  }

  getSelectedText(): string {

    const range = this.getSelection();
    // console.log('range', range);
    if (!range || range.collapsed) {
      return 'NO RANGE';
    }

    const walker = new TreeWalker(
      range.commonAncestorContainer,
      Ambient.SHOW_TEXT | Ambient.SHOW_ELEMENT,
      function (n) {
        return Ranger.isNodeContainedInRange(range, n, true);
      }
    );
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;
    let node = walker.currentNode = startContainer;
    let textContent = '';
    let addedTextInBlock = false;
    let value;

    if (!walker.filter(node)) {
      node = walker.nextNode();
    }

    while (node) {
      if (node.nodeType === Ambient.TEXT_NODE) {
        value = node.data;
        if (value && (/\S/.test(value))) {
          if (node === endContainer) {
            value = value.slice(0, range.endOffset);
          }
          if (node === startContainer) {
            value = value.slice(range.startOffset);
          }
          textContent += value;
          addedTextInBlock = true;
        }
      } else if (node.nodeName === 'BR' ||
        addedTextInBlock && !Noder.isInline(node)) {
        textContent += '\n';
        addedTextInBlock = false;
      }
      node = walker.nextNode();
    }

    return textContent;
  }

  getPath() {

    return this._path;
  }

  // --- Workaround for browsers that can't focus empty text nodes ---

  // WebKit bug: https://bugs.webkit.org/show_bug.cgi?id=15256

  // Walk down the tree starting at the root and remove any ZWS. If the node only
  // contained ZWS space then remove it too. We may want to keep one ZWS node at
  // the bottom of the tree so the block can be selected. Define that node as the
  // keepNode.
  removeZWS(root, keepNode = false) {

    /*
    let walker = new TreeWalker(root, Ambient.SHOW_TEXT, function () {
          return true;
        }, false),
    */


    const walker = new TreeWalker(root, Ambient.SHOW_TEXT, function () {
      return true;
    });
    let parent, node, index;
    while (node = walker.nextNode()) {
      while ((index = node.data.indexOf(Ambient.ZWS)) > -1 &&
        (!keepNode || node.parentNode !== keepNode)) {
        if (node.length === 1) {
          do {
            parent = node.parentNode;
            parent.removeChild(node);
            node = parent;
            walker.currentNode = parent;
          } while (Noder.isInline(node) && !Noder.getLength(node));
          break;
        } else {
          node.deleteData(index, 1);
        }
      }
    }
  }

  _didAddZWS() {

    this._hasZWS = true;
  }

  _removeZWS() {

    if (!this._hasZWS) {
      return;
    }
    this.removeZWS(this._root);
    this._hasZWS = false;
  }

  // --- Path change events ---

  _updatePath(range, force?) {

    // console.log('Risque._updatePath ', range);
    if (!range) {
      return;
    }

    const anchor = range.startContainer,
      focus = range.endContainer;
    let newPath;

    if (force || anchor !== this._lastAnchorNode ||
      focus !== this._lastFocusNode) {

      this._lastAnchorNode = anchor;

      this._lastFocusNode = focus;

      newPath = (anchor && focus) ? (anchor === focus) ?
        Noder.getPath(focus, this._root) : '(selection)' : '';

      // console.log('this._path  ',this._path );
      // console.log('newPath ',newPath);

      if (this._path !== newPath) {

        this._path = newPath;

        this.fireEvent('pathChange', { path: newPath });
      }
    }

    this.fireEvent(range.collapsed ? 'cursor' : 'select', {
      range: range
    });
  }

  // selectionchange is fired synchronously in IE when removing current selection
  // and when setting new selection; keyup/mouseup may have processing we want
  // to do first. Either way, send to next event loop.
  _updatePathOnEvent(event) {

    const self = this;
    if (self._isFocused && !self._willUpdatePath) {
      self._willUpdatePath = true;
      setTimeout(function () {
        self._willUpdatePath = false;
        self._updatePath(self.getSelection());
      }, 0);
    }
  }

  // --- Focus ---

  focus() {

    this._root.focus();

    if (Ambient.isIE) {
      this.fireEvent('focus');
    }

    return this;
  }

  blur() {

    this._root.blur();

    if (Ambient.isIE) {
      this.fireEvent('blur');
    }

    return this;
  }

  // --- Bookmarking ---


  _saveRangeToBookmark(range) {

    let startNode = this.createElement('INPUT', {
      id: this.startSelectionId,
      type: 'hidden'
    }),
      endNode = this.createElement('INPUT', {
        id: this.endSelectionId,
        type: 'hidden'
      }),
      temp;

    Ranger.insertNodeInRange(range, startNode);
    range.collapse(false);
    Ranger.insertNodeInRange(range, endNode);

    // In a collapsed range, the start is sometimes inserted after the end!
    if (startNode.compareDocumentPosition(endNode) &
      Ambient.DOCUMENT_POSITION_PRECEDING) {
      startNode.id = this.endSelectionId;
      endNode.id = this.startSelectionId;
      temp = startNode;
      startNode = endNode;
      endNode = temp;
    }

    range.setStartAfter(startNode);
    range.setEndBefore(endNode);
  }

  _getRangeAndRemoveBookmark(range?) {

    const root = this._root,
      start = root.querySelector('#' + this.startSelectionId),
      end = root.querySelector('#' + this.endSelectionId);

    if (start && end) {
      let startContainer = start.parentNode,
        endContainer = end.parentNode,
        endOffset = Array.prototype.indexOf.call(endContainer.childNodes, end);
      const startOffset = Array.prototype.indexOf.call(startContainer.childNodes, start);

      if (startContainer === endContainer) {
        endOffset -= 1;
      }

      Noder.detach(start);
      Noder.detach(end);

      if (!range) {
        range = this._doc.createRange();
      }
      range.setStart(startContainer, startOffset);
      range.setEnd(endContainer, endOffset);

      // Merge any text nodes we split
      Noder.mergeInlines(startContainer, range);
      if (startContainer !== endContainer) {
        Noder.mergeInlines(endContainer, range);
      }

      // If we didn't split a text node, we should move into any adjacent
      // text node to current selection point
      if (range.collapsed) {

        startContainer = range.startContainer;
        let eContainer;

        if (startContainer.nodeType === Ambient.TEXT_NODE) {

          eContainer = startContainer.childNodes[range.startOffset];
          endContainer = eContainer;

          if (!endContainer || endContainer.nodeType !== Ambient.TEXT_NODE) {

            eContainer = startContainer.childNodes[range.startOffset - 1];
            endContainer = eContainer;
          }

          if (endContainer && endContainer.nodeType === Ambient.TEXT_NODE) {
            range.setStart(endContainer, 0);
            range.collapse(true);
          }
        }

      }
    }
    return range || null;
  }

  // --- Undo ---

  _keyUpDetectChange(event) {

    const code = event.keyCode;
    // Presume document was changed if:
    // 1. A modifier key (other than shift) wasn't held down
    // 2. The key pressed is not in range 16<=x<=20 (control keys)
    // 3. The key pressed is not in range 33<=x<=45 (navigation keys)
    if (!event.ctrlKey && !event.metaKey && !event.altKey &&
      (code < 16 || code > 20) &&
      (code < 33 || code > 45)) {
      this._docWasChanged();
    }
  }

  _docWasChanged() {

    if (Ambient.canWeakMap) {
      this.nodeCategoryCache = new WeakMap();
    }
    if (this._ignoreAllChanges) {
      return;
    }

    if (Ambient.canObserveMutations && this._ignoreChange) {
      this._ignoreChange = false;
      return;
    }
    if (this._isInUndoState) {
      this._isInUndoState = false;
      this.fireEvent('undoStateChange', {
        canUndo: true,
        canRedo: false
      });
    }
    this.fireEvent('input');
  }

  // Leaves bookmark
  _recordUndoState(range, replace?) {

    // Don't record if we're already in an undo state
    if (!this._isInUndoState || replace) {
      // Advance pointer to new position
      let undoIndex = this._undoIndex;
      const undoStack = this._undoStack;
      const undoConfig = this._config.undo;
      const undoThreshold = undoConfig.documentSizeThreshold;
      const undoLimit = undoConfig.undoLimit;
      let html;

      if (!replace) {
        undoIndex += 1;
      }

      // Truncate stack if longer (i.e. if has been previously undone)
      if (undoIndex < this._undoStackLength) {
        undoStack.length = this._undoStackLength = undoIndex;
      }

      // Get data
      if (range) {
        this._saveRangeToBookmark(range);
      }
      html = this._getHTML();

      // If this document is above the configured size threshold,
      // limit the number of saved undo states.
      // Threshold is in bytes, JS uses 2 bytes per character
      if (undoThreshold > -1 && html.length * 2 > undoThreshold) {
        if (undoLimit > -1 && undoIndex > undoLimit) {
          undoStack.splice(0, undoIndex - undoLimit);
          undoIndex = undoLimit;
          this._undoStackLength = undoLimit;
        }
      }

      // Save data
      undoStack[undoIndex] = html;
      this._undoIndex = undoIndex;
      this._undoStackLength += 1;
      this._isInUndoState = true;
    }
  }

  saveUndoState(range?) {

    if (range === undefined) {
      range = this.getSelection();
    }
    this._recordUndoState(range, this._isInUndoState);
    this._getRangeAndRemoveBookmark(range);

    return this;
  }

  undo() {

    // Sanity check: must not be at beginning of the history stack
    if (this._undoIndex !== 0 || !this._isInUndoState) {
      // Make sure any changes since last checkpoint are saved.
      this._recordUndoState(this.getSelection(), false);

      this._undoIndex -= 1;
      this._setHTML(this._undoStack[this._undoIndex]);
      const range = this._getRangeAndRemoveBookmark();
      if (range) {
        this.setSelection(range);
      }
      this._isInUndoState = true;
      this.fireEvent('undoStateChange', {
        canUndo: this._undoIndex !== 0,
        canRedo: true
      });
      this.fireEvent('input');
    }
    return this;
  }

  redo() {

    // Sanity check: must not be at end of stack and must be in an undo
    // state.
    const undoIndex = this._undoIndex,
      undoStackLength = this._undoStackLength;
    if (undoIndex + 1 < undoStackLength && this._isInUndoState) {
      this._undoIndex += 1;
      this._setHTML(this._undoStack[this._undoIndex]);
      const range = this._getRangeAndRemoveBookmark();
      if (range) {
        this.setSelection(range);
      }
      this.fireEvent('undoStateChange', {
        canUndo: true,
        canRedo: undoIndex + 2 < undoStackLength
      });
      this.fireEvent('input');
    }
    return this;
  }
  // --------------- CHANGES/UNDO/REDO - end


  // --- Inline formatting ---

  // Looks for matching tag and attributes, so won't work
  // if <strong> instead of <b> etc.
  hasFormat(tag, attributes?, range?) {
    // 1. Normalise the arguments and get selection

    if (typeof tag === 'object') {
      tag.map(function (e) { return e.toUpperCase(); });
    } else {
      tag = tag.toUpperCase();
    }
    if (!attributes) { attributes = {}; }
    if (!range && !(range = this.getSelection())) {
      return false;
    }

    // Sanitize range to prevent weird IE artifacts
    if (!range.collapsed &&
      range.startContainer.nodeType === Ambient.TEXT_NODE &&
      range.startOffset === range.startContainer.length &&
      range.startContainer.nextSibling) {
      range.setStartBefore(range.startContainer.nextSibling);
    }
    if (!range.collapsed &&
      range.endContainer.nodeType === Ambient.TEXT_NODE &&
      range.endOffset === 0 &&
      range.endContainer.previousSibling) {
      range.setEndAfter(range.endContainer.previousSibling);
    }

    // If the common ancestor is inside the tag we require, we definitely
    // have the format.
    const root = this._root;
    const common = range.commonAncestorContainer;
    let walker, node;
    if (Noder.getNearest(common, root, tag, attributes)) {
      return true;
    }

    // If common ancestor is a text node and doesn't have the format, we
    // definitely don't have it.
    if (common.nodeType === Ambient.TEXT_NODE) {
      return false;
    }

    // Otherwise, check each text node at least partially contained within
    // the selection and make sure all of them have the format we want.
    walker = new TreeWalker(common, Ambient.SHOW_TEXT, function (n) {
      return Ranger.isNodeContainedInRange(range, n, true);
    });

    let seenNode = false;
    while (node = walker.nextNode()) {
      if (!Noder.getNearest(node, root, tag, attributes)) {
        return false;
      }
      seenNode = true;
    }

    return seenNode;
  }

  // Extracts the font-family and font-size (if any) of the element
  // holding the cursor. If there's a selection, returns an empty object.
  getFontInfo(range?): any {

    const fontInfo = {
      'color': undefined,
      'background-color': undefined,
      'font-family': undefined,
      'font-size': undefined,
      'line-height': undefined,
      'underline': this.hasFormat('U', {}, range),
      'italic': this.hasFormat('I', {}, range),
      'bold': this.hasFormat('B', {}, range),
      'strike': this.hasFormat('S', {}, range),
      'sub': this.hasFormat('SUB', {}, range),
      'sup': this.hasFormat('SUP', {}, range),
    };


    let seenAttributes = 0;
    let element, style, attr;

    if (!range && !(range = this.getSelection())) {
      return fontInfo;
    }

    element = range.commonAncestorContainer;

    if (range.collapsed || element.nodeType === Ambient.TEXT_NODE) {
      if (element.nodeType === Ambient.TEXT_NODE) {
        element = element.parentNode;
      }
      while (seenAttributes < Ambient.classesCount && element) {
        if (style = element.style) {
          if (!fontInfo.color && (attr = style.color)) {
            fontInfo.color = attr;
            seenAttributes += 1;
          }
          if (!fontInfo['background-color'] &&
            (attr = style.backgroundColor)) {
            fontInfo['background-color'] = attr;
            seenAttributes += 1;
          }
          if (!fontInfo['font-family'] && (attr = style.fontFamily)) {
            fontInfo['font-family'] = attr;
            seenAttributes += 1;
          }
          if (!fontInfo['font-size'] && (attr = style.fontSize)) {
            fontInfo['font-size'] = attr;
            seenAttributes += 1;
          }
          if (!fontInfo['line-height'] && (attr = style.lineHeight)) {
            fontInfo['line-height'] = attr;
            seenAttributes += 1;
          }
        }
        element = element.parentNode;
      }
    }

    return fontInfo;
  }

  _addFormat(tag, attributes, range) {


    // If the range is collapsed we simply insert the node by wrapping
    // it round the range and focus it.
    const root = this._root;
    let el, walker, startContainer, endContainer, startOffset, endOffset,
      node, needsFormat, block;

    if (range.collapsed) {
      el = Noder.fixCursor(this.createElement(tag, attributes), root);
      Ranger.insertNodeInRange(range, el);
      range.setStart(el.firstChild, el.firstChild.length);
      range.collapse(true);

      // Clean up any previous formats that may have been set on this block
      // that are unused.
      block = el;
      while (Noder.isInline(block)) {
        block = block.parentNode;
      }
      this.removeZWS(block, el);
    } else {
      // Create an iterator to walk over all the text nodes under this
      // ancestor which are in the range and not already formatted
      // correctly.
      //
      // In Blink/WebKit, empty blocks may have no text nodes, just a <br>.
      // Therefore we wrap this in the tag as well, as this will then cause it
      // to apply when the user types something in the block, which is
      // presumably what was intended.
      //
      // IMG tags are included because we may want to create a link around
      // them, and adding other styles is harmless.
      walker = new TreeWalker(
        range.commonAncestorContainer,
        Ambient.SHOW_TEXT | Ambient.SHOW_ELEMENT,
        function (n) {
          return (n.nodeType === Ambient.TEXT_NODE ||
            n.nodeName === 'BR' ||
            n.nodeName === 'IMG'
          ) && Ranger.isNodeContainedInRange(range, n, true);
        }
      );

      // Start at the beginning node of the range and iterate through
      // all the nodes in the range that need formatting.
      startContainer = range.startContainer;
      startOffset = range.startOffset;
      endContainer = range.endContainer;
      endOffset = range.endOffset;

      // Make sure we start with a valid node.
      walker.currentNode = startContainer;
      if (!walker.filter(startContainer)) {
        startContainer = walker.nextNode();
        startOffset = 0;
      }

      // If there are no interesting nodes in the selection, abort
      if (!startContainer) {
        return range;
      }

      do {
        node = walker.currentNode;
        needsFormat = !Noder.getNearest(node, root, tag, attributes);
        if (needsFormat) {
          // <br> can never be a container node, so must have a text node
          // if node == (end|start)Container
          if (node === endContainer && node.length > endOffset) {
            node.splitText(endOffset);
          }
          if (node === startContainer && startOffset) {
            node = node.splitText(startOffset);
            if (endContainer === startContainer) {
              endContainer = node;
              endOffset -= startOffset;
            }
            startContainer = node;
            startOffset = 0;
          }
          el = this.createElement(tag, attributes);
          Noder.replaceWith(node, el);
          el.appendChild(node);
        }
      } while (walker.nextNode());

      // If we don't finish inside a text node, offset may have changed.
      if (endContainer.nodeType !== Ambient.TEXT_NODE) {
        if (node.nodeType === Ambient.TEXT_NODE) {
          endContainer = node;
          endOffset = node.length;
        } else {
          // If <br>, we must have just wrapped it, so it must have only
          // one child
          endContainer = node.parentNode;
          endOffset = 1;
        }
      }

      // Now set the selection to as it was before
      range = this._createRange(
        startContainer, startOffset, endContainer, endOffset);
    }
    return range;

  }

  _removeFormat(tag, attributes, range, partial) {


    // Add bookmark
    this._saveRangeToBookmark(range);

    // We need a node in the selection to break the surrounding
    // formatted text.
    const doc = this._doc;
    let fixer;
    if (range.collapsed) {
      if (Ambient.cantFocusEmptyTextNodes) {
        fixer = doc.createTextNode(Ambient.ZWS);
        this._didAddZWS();
      } else {
        fixer = doc.createTextNode('');
      }
      Ranger.insertNodeInRange(range, fixer);
    }

    // Find block-level ancestor of selection
    let root = range.commonAncestorContainer;
    while (Noder.isInline(root)) {
      root = root.parentNode;
    }

    // Find text nodes inside formatTags that are not in selection and
    // add an extra tag with the same formatting.
    const startContainer = range.startContainer,
      startOffset = range.startOffset,
      endContainer = range.endContainer,
      endOffset = range.endOffset,
      toWrap = [],
      examineNode = function (node, exemplar) {
        // If the node is completely contained by the range then
        // we're going to remove all formatting so ignore it.
        if (Ranger.isNodeContainedInRange(range, node, false)) {
          return;
        }

        const isText = (node.nodeType === Ambient.TEXT_NODE);
        let child, next;

        // If not at least partially contained, wrap entire contents
        // in a clone of the tag we're removing and we're done.
        if (!Ranger.isNodeContainedInRange(range, node, true)) {
          // Ignore bookmarks and empty text nodes
          if (node.nodeName !== 'INPUT' &&
            (!isText || node.data)) {
            toWrap.push([exemplar, node]);
          }
          return;
        }

        // Split any partially selected text nodes.
        if (isText) {
          if (node === endContainer && endOffset !== node.length) {
            toWrap.push([exemplar, node.splitText(endOffset)]);
          }
          if (node === startContainer && startOffset) {
            node.splitText(startOffset);
            toWrap.push([exemplar, node]);
          }
        } else {
          for (child = node.firstChild; child; child = next) {
            next = child.nextSibling;
            examineNode(child, exemplar);
          }
        }
      },
      formatTags = Array.prototype.filter.call(
        root.getElementsByTagName(tag), function (el) {
          return Ranger.isNodeContainedInRange(range, el, true) &&
            Noder.hasTagAttributes(el, tag, attributes);
        }
      );

    if (!partial) {
      formatTags.forEach(function (node) {
        examineNode(node, node);
      });
    }

    // Now wrap unselected nodes in the tag
    toWrap.forEach(function (item) {
      // [ exemplar, node ] tuple
      const el = item[0].cloneNode(false),
        node = item[1];
      Noder.replaceWith(node, el);
      el.appendChild(node);
    });
    // and remove old formatting tags.
    formatTags.forEach(function (el) {
      Noder.replaceWith(el, Noder.empty(el));
    });

    // Merge adjacent inlines:
    this._getRangeAndRemoveBookmark(range);
    if (fixer) {
      range.collapse(false);
    }
    Noder.mergeInlines(root, range);

    return range;

  }

  changeFormat(add, remove, range?, partial?) {

    // Normalise the arguments and get selection
    if (!range && !(range = this.getSelection())) {
      return this;
    }

    // console.log('range is', range);

    // Save undo checkpoint
    this.saveUndoState(range);

    if (remove) {
      range = this._removeFormat(remove.tag.toUpperCase(),
        remove.attributes || {}, range, partial);
    }
    if (add) {
      range = this._addFormat(add.tag.toUpperCase(),
        add.attributes || {}, range);
    }

    this.setSelection(range);
    this._updatePath(range, true);

    // We're not still in an undo state
    if (!Ambient.canObserveMutations) {
      this._docWasChanged();
    }

    return this;
  }

  testPresenceinSelection(format, validation) {
    const path = this.getPath();
    const test = (validation.test(path) || this.hasFormat(format));
    if (test) {
      return true;
    } else {
      return false;
    }
  }


  toggleFormat(tagSymbol, regex) {

    if (this.testPresenceinSelection(tagSymbol, regex)) {
      this.changeFormat(null, { tag: tagSymbol });
    } else {
      this.changeFormat({ tag: tagSymbol }, null);
    }
  }


  // --- Block formatting ---


  splitBlock(self, block, node, offset) {

    let splitTag = this.tagAfterSplit[block.nodeName],
      splitProperties = null,
      nodeAfterSplit = Noder.split(node, offset, block.parentNode, self._root);
    const config = self._config;

    if (!splitTag) {
      splitTag = config.blockTag;
      splitProperties = config.blockAttributes;
    }

    // Make sure the new node is the correct type.
    if (!Noder.hasTagAttributes(nodeAfterSplit, splitTag, splitProperties)) {
      block = this.createElement(nodeAfterSplit.ownerDocument,
        splitTag, splitProperties);
      if (nodeAfterSplit.dir) {
        block.dir = nodeAfterSplit.dir;
      }
      Noder.replaceWith(nodeAfterSplit, block);
      block.appendChild(Noder.empty(nodeAfterSplit));
      nodeAfterSplit = block;
    }
    return nodeAfterSplit;
  }

  forEachBlock(fn, mutates, range?) {

    if (!range && !(range = this.getSelection())) {
      return this;
    }

    // Save undo checkpoint
    if (mutates) {
      this.saveUndoState(range);
    }

    const root = this._root;
    let start = Ranger.getStartBlockOfRange(range, root);
    const end = Ranger.getEndBlockOfRange(range, root);
    if (start && end) {
      do {
        if (fn(start) || start === end) { break; }
      } while (start = Noder.getNextBlock(start, root));
    }

    if (mutates) {
      this.setSelection(range);

      // Path may have changed
      this._updatePath(range, true);

      // We're not still in an undo state
      if (!Ambient.canObserveMutations) {
        this._docWasChanged();
      }
    }
    return this;

  }

  modifyBlocks(modify, range?) {


    if (!range && !(range = this.getSelection())) {
      return this;
    }

    // 1. Save undo checkpoint and bookmark selection
    this._recordUndoState(range, this._isInUndoState);

    const root = this._root;
    let frag;

    // 2. Expand range to block boundaries
    Ranger.expandRangeToBlockBoundaries(range, root);

    // 3. Remove range.
    Ranger.moveRangeBoundariesUpTree(range, root, root, root);
    frag = Ranger.extractContentsOfRange(range, root, root);

    // 4. Modify tree of fragment and reinsert.
    Ranger.insertNodeInRange(range, modify.call(this, frag));

    // 5. Merge containers at edges
    if (range.endOffset < range.endContainer.childNodes.length) {
      Noder.mergeContainers(range.endContainer.childNodes[range.endOffset], root);
    }
    Noder.mergeContainers(range.startContainer.childNodes[range.startOffset], root);

    // 6. Restore selection
    this._getRangeAndRemoveBookmark(range);
    this.setSelection(range);
    this._updatePath(range, true);

    // 7. We're not still in an undo state
    if (!Ambient.canObserveMutations) {
      this._docWasChanged();
    }

    return this;

  }

  increaseBlockQuoteLevel(frag) {

    return this.createElement('BLOCKQUOTE',
      this._config.tagAttributes.blockquote, [
        frag
      ]);
  }

  decreaseBlockQuoteLevel(frag) {

    const root = this._root;
    const blockquotes = frag.querySelectorAll('blockquote');
    Array.prototype.filter.call(blockquotes, function (el) {
      return !Noder.getNearest(el.parentNode, root, 'BLOCKQUOTE');
    }).forEach(function (el) {
      Noder.replaceWith(el, Noder.empty(el));
    });
    return frag;
  }

  removeBlockQuote() {

    return this.createDefaultBlock([
      this.createElement('INPUT', {
        id: this.startSelectionId,
        type: 'hidden'
      }),
      this.createElement('INPUT', {
        id: this.endSelectionId,
        type: 'hidden'
      })
    ]);
  }

  makeList(self, frag, type) {


    const walker = Noder.getBlockWalker(frag, self._root),
      tagAttributes = self._config.tagAttributes,
      listAttrs = tagAttributes[type.toLowerCase()],
      listItemAttrs = tagAttributes.li;
    let node, tag, prev, newLi;

    while (node = walker.nextNode()) {
      if (node.parentNode.nodeName === 'LI') {
        node = node.parentNode;
        walker.currentNode = node.lastChild;
      }
      if (node.nodeName !== 'LI') {
        newLi = self.createElement('LI', listItemAttrs);
        if (node.dir) {
          newLi.dir = node.dir;
        }

        // Have we replaced the previous block with a new <ul>/<ol>?
        if ((prev = node.previousSibling) && prev.nodeName === type) {
          prev.appendChild(newLi);
          Noder.detach(node);
        } else {
          Noder.replaceWith(
            node,
            self.createElement(type, listAttrs, [
              newLi
            ])
          );
        }
        newLi.appendChild(Noder.empty(node));
        walker.currentNode = newLi;
      } else {
        node = node.parentNode;
        tag = node.nodeName;
        if (tag !== type && (/^[OU]L$/.test(tag))) {
          Noder.replaceWith(node,
            self.createElement(type, listAttrs, [Noder.empty(node)])
          );
        }
      }
    }

  }

  makeUnorderedList(frag) {

    this.makeList(this, frag, 'UL');
    return frag;
  }

  makeOrderedList(frag) {

    this.makeList(this, frag, 'OL');
    return frag;
  }

  removeList(frag) {

    const lists = frag.querySelectorAll('UL, OL'),
      items = frag.querySelectorAll('LI'),
      root = this._root;
    let i, l, list, listFrag, item;
    for (i = 0, l = lists.length; i < l; i += 1) {
      list = lists[i];
      listFrag = Noder.empty(list);
      Noder.fixContainer(listFrag, root);
      Noder.replaceWith(list, listFrag);
    }

    for (i = 0, l = items.length; i < l; i += 1) {
      item = items[i];
      if (Noder.isBlock(item)) {
        Noder.replaceWith(item,
          this.createDefaultBlock([Noder.empty(item)])
        );
      } else {
        Noder.fixContainer(item, root);
        Noder.replaceWith(item, Noder.empty(item));
      }
    }
    return frag;
  }

  getListSelection(range, root) {

    // Get start+end li in single common ancestor
    let list = range.commonAncestorContainer;
    let startLi = range.startContainer;
    let endLi = range.endContainer;
    while (list && list !== root && !/^[OU]L$/.test(list.nodeName)) {
      list = list.parentNode;
    }
    if (!list || list === root) {
      return null;
    }
    if (startLi === list) {
      startLi = startLi.childNodes[range.startOffset];
    }
    if (endLi === list) {
      endLi = endLi.childNodes[range.endOffset];
    }
    while (startLi && startLi.parentNode !== list) {
      startLi = startLi.parentNode;
    }
    while (endLi && endLi.parentNode !== list) {
      endLi = endLi.parentNode;
    }
    return [list, startLi, endLi];
  }

  increaseListLevel(range) {

    if (!range && !(range = this.getSelection())) {
      return this.focus();
    }

    const root = this._root;
    const listSelection = this.getListSelection(range, root);
    if (!listSelection) {
      return this.focus();
    }

    const list = listSelection[0];
    let startLi = listSelection[1];
    const endLi = listSelection[2];
    if (!startLi || startLi === list.firstChild) {
      return this.focus();
    }

    // Save undo checkpoint and bookmark selection
    this._recordUndoState(range, this._isInUndoState);

    // Increase list depth
    const type = list.nodeName;
    let newParent = startLi.previousSibling;
    let listAttrs, next;
    if (newParent.nodeName !== type) {
      listAttrs = this._config.tagAttributes[type.toLowerCase()];
      newParent = this.createElement(type, listAttrs);
      list.insertBefore(newParent, startLi);
    }
    do {
      next = startLi === endLi ? null : startLi.nextSibling;
      newParent.appendChild(startLi);
    } while ((startLi = next));
    next = newParent.nextSibling;
    if (next) {
      Noder.mergeContainers(next, root);
    }

    // Restore selection
    this._getRangeAndRemoveBookmark(range);
    this.setSelection(range);
    this._updatePath(range, true);

    // We're not still in an undo state
    if (!Ambient.canObserveMutations) {
      this._docWasChanged();
    }

    return this.focus();
  }

  decreaseListLevel(range) {


    if (!range && !(range = this.getSelection())) {
      return this.focus();
    }

    const root = this._root;
    const listSelection = this.getListSelection(range, root);
    if (!listSelection) {
      return this.focus();
    }

    const list = listSelection[0];
    let startLi = listSelection[1];
    let endLi = listSelection[2];
    if (!startLi) {
      startLi = list.firstChild;
    }
    if (!endLi) {
      endLi = list.lastChild;
    }

    // Save undo checkpoint and bookmark selection
    this._recordUndoState(range, this._isInUndoState);

    // Find the new parent list node
    let newParent = list.parentNode;
    let next;

    // Split list if necesary
    let insertBefore = !endLi.nextSibling ?
      list.nextSibling :
      Noder.split(list, endLi.nextSibling, newParent, root);

    if (newParent !== root && newParent.nodeName === 'LI') {
      newParent = newParent.parentNode;
      while (insertBefore) {
        next = insertBefore.nextSibling;
        endLi.appendChild(insertBefore);
        insertBefore = next;
      }
      insertBefore = list.parentNode.nextSibling;
    }

    const makeNotList = !/^[OU]L$/.test(newParent.nodeName);
    do {
      next = startLi === endLi ? null : startLi.nextSibling;
      list.removeChild(startLi);
      if (makeNotList && startLi.nodeName === 'LI') {
        startLi = this.createDefaultBlock([Noder.empty(startLi)]);
      }
      newParent.insertBefore(startLi, insertBefore);
    } while ((startLi = next));

    if (!list.firstChild) {
      Noder.detach(list);
    }

    if (insertBefore) {
      Noder.mergeContainers(insertBefore, root);
    }

    // Restore selection
    this._getRangeAndRemoveBookmark(range);
    this.setSelection(range);
    this._updatePath(range, true);

    // We're not still in an undo state
    if (!Ambient.canObserveMutations) {
      this._docWasChanged();
    }

    return this.focus();

  }

  _ensureBottomLine() {

    const root = this._root;
    const last = root.lastElementChild;
    if (!last ||
      last.nodeName !== this._config.blockTag || !Noder.isBlock(last)) {
      root.appendChild(this.createDefaultBlock());
    }
  }

  // --- Keyboard interaction ---

  setKeyHandler(key, fn) {

    // this._keyHandlers[ key ] = fn;
    return this;
  }

  // --- Get/Set data ---

  _getHTML() {

    return this._root.innerHTML;
  }

  _setHTML(html) {

    const root = this._root;
    let node = root;
    node.innerHTML = html;
    do {
      Noder.fixCursor(node, root);
    } while (node = Noder.getNextBlock(node, root));
    this._ignoreChange = true;
  }

  getHTML(withBookMark?) {
    const brs = [];
    let root, node, fixer, html, l, range;

    if (withBookMark && (range = this.getSelection())) {
      this._saveRangeToBookmark(range);
    }
    if (Ambient.useTextFixer) {
      root = this._root;
      node = root;
      while (node = Noder.getNextBlock(node, root)) {
        if (!node.textContent && !node.querySelector('BR')) {
          fixer = this.createElement('BR');
          node.appendChild(fixer);
          brs.push(fixer);
        }
      }
    }
    html = this._getHTML().replace(/\u200B/g, '');
    if (Ambient.useTextFixer) {
      l = brs.length;
      while (l--) {
        Noder.detach(brs[l]);
      }
    }
    if (range) {
      this._getRangeAndRemoveBookmark(range);
    }
    return html;
  }

  setHTML(html) {

    const config = this._config;
    const sanitizeToDOMFragment = config.isSetHTMLSanitized ?
      config.sanitizeToDOMFragment : null;
    const root = this._root;
    let div, frag, child;

    // Parse HTML into DOM tree
    if (typeof sanitizeToDOMFragment === 'function') {
      frag = sanitizeToDOMFragment(html, false, this);
    } else {
      div = this.createElement('DIV');
      div.innerHTML = html;
      frag = this.doc.createDocumentFragment();
      frag.appendChild(Noder.empty(div));
    }

    this.clean.cleanTree(frag);
    this.clean.cleanupBRs(frag, root, false);

    Noder.fixContainer(frag, root);

    // Fix cursor
    let node = frag;
    while (node = Noder.getNextBlock(node, root)) {
      Noder.fixCursor(node, root);
    }

    // Don't fire an input event
    this._ignoreChange = true;

    // Remove existing root children
    while (child = root.lastChild) {
      root.removeChild(child);
    }

    // And insert new content
    root.appendChild(frag);
    Noder.fixCursor(root, root);

    // Reset the undo stack
    this._undoIndex = -1;
    this._undoStack.length = 0;
    this._undoStackLength = 0;
    this._isInUndoState = false;

    // Record undo state
    const range = this._getRangeAndRemoveBookmark() ||
      this._createRange(root.firstChild, 0);
    this.saveUndoState(range);
    // IE will also set focus when selecting text so don't use
    // setSelection. Instead, just store it in lastSelection, so if
    // anything calls getSelection before first focus, we have a range
    // to return.
    this._lastSelection = range;
    this.enableRestoreSelection.call(this);
    this._updatePath(range, true);

    return this;
  }

  insertElement(el, range?) {


    if (!range) {
      range = this.getSelection();
    }
    range.collapse(true);
    if (Noder.isInline(el)) {
      Ranger.insertNodeInRange(range, el);
      range.setStartAfter(el);
    } else {
      // Get containing block node.
      const root = this._root;
      let splitNode = Ranger.getStartBlockOfRange(range, root) || root;
      let parent, nodeAfterSplit;
      // While at end of container node, move up DOM tree.
      while (splitNode !== root && !splitNode.nextSibling) {
        splitNode = splitNode.parentNode;
      }
      // If in the middle of a container node, split up to root.
      if (splitNode !== root) {
        parent = splitNode.parentNode;
        nodeAfterSplit = Noder.split(parent, splitNode.nextSibling, root, root);
      }
      if (nodeAfterSplit) {
        root.insertBefore(el, nodeAfterSplit);
      } else {
        root.appendChild(el);
        // Insert blank line below block.
        nodeAfterSplit = this.createDefaultBlock();
        root.appendChild(nodeAfterSplit);
      }
      range.setStart(nodeAfterSplit, 0);
      range.setEnd(nodeAfterSplit, 0);
      Ranger.moveRangeBoundariesDownTree(range);
    }
    this.focus();
    this.setSelection(range);
    this._updatePath(range);

    if (!Ambient.canObserveMutations) {
      this._docWasChanged();
    }

    return this;

  }

  insertImage(src, attributes) {

    const img = this.createElement('IMG', this.mergeObjects({
      src: src
    }, attributes, true));
    this.insertElement(img);
    return img;
  }

  addLinks(frag, root, self) {


    const doc = frag.ownerDocument,
      walker = new TreeWalker(frag, Ambient.SHOW_TEXT,
        function (n) {
          return !Noder.getNearest(n, root, 'A');
        }),
      defaultAttributes = self._config.tagAttributes.a;
    let node, data, parent, match, index, endIndex, child;

    while (node = walker.nextNode()) {
      data = node.data;
      parent = node.parentNode;
      while (match = this.linkRegExp.exec(data)) {
        index = match.index;
        endIndex = index + match[0].length;
        if (index) {
          child = doc.createTextNode(data.slice(0, index));
          parent.insertBefore(child, node);
        }
        child = self.createElement('A', this.mergeObjects({
          href: match[1] ?
            /^(?:ht|f)tps?:/.test(match[1]) ?
              match[1] :
              'http://' + match[1] :
            'mailto:' + match[2]
        }, defaultAttributes, false));
        child.textContent = data.slice(index, endIndex);
        parent.insertBefore(child, node);
        node.data = data = data.slice(endIndex);
      }
    }

  }

  // Insert HTML at the cursor location. If the selection is not collapsed
  // insertTreeFragmentIntoRange will delete the selection so that it is replaced
  // by the html being inserted.
  insertHTML(html, isPaste = false) {


    const config = this._config;
    const sanitizeToDOMFragment = config.isInsertedHTMLSanitized ?
      config.sanitizeToDOMFragment : null;
    const range = this.getSelection();
    const doc = this._doc;
    let startFragmentIndex, endFragmentIndex;
    let div, frag, root, node, event;

    // Edge doesn't just copy the fragment, but includes the surrounding guff
    // including the full <head> of the page. Need to strip this out. If
    // available use DOMPurify to parse and sanitise.
    if (typeof sanitizeToDOMFragment === 'function') {
      frag = sanitizeToDOMFragment(html, isPaste, this);
    } else {
      if (isPaste) {
        startFragmentIndex = html.indexOf('<!--StartFragment-->');
        endFragmentIndex = html.lastIndexOf('<!--EndFragment-->');
        if (startFragmentIndex > -1 && endFragmentIndex > -1) {
          html = html.slice(startFragmentIndex + 20, endFragmentIndex);
        }
      }
      // Wrap with <tr> if html contains dangling <td> tags
      if (/<\/td>((?!<\/tr>)[\s\S])*$/i.test(html)) {
        html = '<TR>' + html + '</TR>';
      }
      // Wrap with <table> if html contains dangling <tr> tags
      if (/<\/tr>((?!<\/table>)[\s\S])*$/i.test(html)) {
        html = '<TABLE>' + html + '</TABLE>';
      }
      // Parse HTML into DOM tree
      div = this.createElement('DIV');
      div.innerHTML = html;
      frag = doc.createDocumentFragment();
      frag.appendChild(Noder.empty(div));
    }

    // Record undo checkpoint
    this.saveUndoState(range);

    try {
      root = this._root;
      node = frag;
      event = {
        fragment: frag,
        preventDefault: function () {
          this.defaultPrevented = true;
        },
        defaultPrevented: false
      };

      this.addLinks(frag, frag, this);
      this.clean.cleanTree(frag);
      this.clean.cleanupBRs(frag, root, false);
      this.clean.removeEmptyInlines(frag);
      frag.normalize();

      while (node = Noder.getNextBlock(node, frag)) {
        Noder.fixCursor(node, root);
      }

      if (isPaste) {
        this.fireEvent('willPaste', event);
      }

      if (!event.defaultPrevented) {
        Ranger.insertTreeFragmentIntoRange(range, event.fragment, root, this.clean);
        if (!Ambient.canObserveMutations) {
          this._docWasChanged();
        }
        range.collapse(false);
        this._ensureBottomLine();
      }

      this.setSelection(range);
      this._updatePath(range, true);
      // Safari sometimes loses focus after paste. Weird.
      if (isPaste) {
        this.focus();
      }
    } catch (error) {
      this.didError(error);
    }
    return this;

  }

  escapeHTMLFragement(text): string {

    return text.split('&').join('&amp;')
      .split('<').join('&lt;')
      .split('>').join('&gt;')
      .split('"').join('&quot;');
  }

  insertPlainText(plainText, isPaste): Risque {


    const lines = plainText.split('\n');
    const config = this._config;
    const tag = config.blockTag;
    const attributes = config.blockAttributes;
    const closeBlock = '</' + tag + '>';
    let openBlock = '<' + tag;
    let attr, i, l, line;

    for (attr of Object.keys(attributes)) {
      openBlock += ' ' + attr + '="' +
        this.escapeHTMLFragement(attributes[attr]) +
        '"';
    }
    openBlock += '>';

    for (i = 0, l = lines.length; i < l; i += 1) {
      line = lines[i];
      line = this.escapeHTMLFragement(line).replace(/ (?= )/g, '&nbsp;');
      // Wrap each line in <div></div>
      lines[i] = openBlock + (line || '<BR>') + closeBlock;
    }
    return this.insertHTML(lines.join(''), isPaste);

  }

  // --- Formatting ---

  command(method, arg?, arg2?) {

    return function () {
      this[method](arg, arg2);
      return this.focus();
    };
  }

  addStyles(styles) {


    if (styles) {
      const head = this._doc.documentElement.firstChild,
        style = this.createElement('STYLE', {
          type: 'text/css'
        });
      style.appendChild(this._doc.createTextNode(styles));
      head.appendChild(style);
    }
    return this;

  }
  bold() { console.log('BOLD'); this.command('changeFormat', { tag: 'B' }); }

  /*
  italic = command( 'changeFormat', { tag: 'I' } );
  underline = command( 'changeFormat', { tag: 'U' } );
  strikethrough = command( 'changeFormat', { tag: 'S' } );
  subscript = command( 'changeFormat', { tag: 'SUB' }, { tag: 'SUP' } );
  superscript = command( 'changeFormat', { tag: 'SUP' }, { tag: 'SUB' } );

  removeBold = command( 'changeFormat', null, { tag: 'B' } );
  removeItalic = command( 'changeFormat', null, { tag: 'I' } );
  removeUnderline = command( 'changeFormat', null, { tag: 'U' } );
  removeStrikethrough = command( 'changeFormat', null, { tag: 'S' } );
  removeSubscript = command( 'changeFormat', null, { tag: 'SUB' } );
  removeSuperscript = command( 'changeFormat', null, { tag: 'SUP' } );
  */

  makeLink(url, attributes): Risque {


    const range = this.getSelection();
    if (range.collapsed) {
      let protocolEnd = url.indexOf(':') + 1;
      if (protocolEnd) {
        while (url[protocolEnd] === '/') { protocolEnd += 1; }
      }
      Ranger.insertNodeInRange(
        range,
        this._doc.createTextNode(url.slice(protocolEnd))
      );
    }
    attributes = this.mergeObjects(
      this.mergeObjects({
        href: url
      }, attributes, true),
      this._config.tagAttributes.a,
      false
    );

    this.changeFormat({
      tag: 'A',
      attributes: attributes
    }, {
        tag: 'A'
      }, range);
    return this.focus();

  }

  removeLink(): Risque {

    this.changeFormat(null, {
      tag: 'A'
    }, this.getSelection(), true);
    return this.focus();
  }

  setFontFamily(name): Risque {

    this.changeFormat(name ? {
      tag: 'SPAN',
      attributes: {
        'class': Ambient.FONT_FAMILY_CLASS,
        style: 'font-family: ' + name + ', sans-serif;'
      }
    } : null, {
        tag: 'SPAN',
        attributes: { 'class': Ambient.FONT_FAMILY_CLASS }
      });
    return this.focus();

  }

  setFontSize(size) {

    this.changeFormat(size ? {
      tag: 'SPAN',
      attributes: {
        'class': Ambient.FONT_SIZE_CLASS,
        style: 'font-size: ' +
          (typeof size === 'number' ? size + 'px' : size)
      }
    } : null, {
        tag: 'SPAN',
        attributes: { 'class': Ambient.FONT_SIZE_CLASS }
      });
    return this.focus();
  }


  setNumeriProp(size, prop) {

    this.changeFormat(size ? {
      tag: 'SPAN',
      attributes: {
        'class': prop,
        style: prop + ': ' +
          (typeof size === 'number' ? size + 'px' : size)
      }
    } : null, {
        tag: 'SPAN',
        attributes: { 'class': prop }
      });
    return this.focus();
  }

  setTextColor(color): Risque {

    return this.setTextColour(color);
  }

  setTextColour(color) {

    this.changeFormat(color ? {
      tag: 'SPAN',
      attributes: {
        'class': Ambient.COLOR_CLASS,
        style: 'color:' + color
      }
    } : null, {
        tag: 'SPAN',
        attributes: { 'class': Ambient.COLOR_CLASS }
      });
    return this.focus();
  }

  setBackgroundColor(color): Risque {

    return this.setHighlightColour(color);
  }

  setHighlightColor(color): Risque {

    return this.setHighlightColour(color);
  }

  setHighlightColour(colour): Risque {

    this.changeFormat(colour ? {
      tag: 'SPAN',
      attributes: {
        'class': Ambient.BACKGROUND_COLOR_CLASS,
        style: 'background-color:' + colour
      }
    } : colour, {
        tag: 'SPAN',
        attributes: { 'class': Ambient.BACKGROUND_COLOR_CLASS }
      });
    return this.focus();
  }

  setTextAlignment(alignment): Risque {

    this.forEachBlock(function (block) {
      const className = block.className
        .split(/\s+/)
        .filter(function (klass) {
          return !!klass && !/^align/.test(klass);
        })
        .join(' ');
      if (alignment) {
        block.className = className + ' align-' + alignment;
        block.style.textAlign = alignment;
      } else {
        block.className = className;
        block.style.textAlign = '';
      }
    }, true);
    return this.focus();

  }

  setTextDirection(direction): Risque {

    this.forEachBlock(function (block) {
      if (direction) {
        block.dir = direction;
      } else {
        block.removeAttribute('dir');
      }
    }, true);
    return this.focus();
  }

  removeFormatting(self, root, clean): Risque {


    let node, next;
    for (node = root.firstChild; node; node = next) {
      next = node.nextSibling;
      if (Noder.isInline(node)) {
        if (node.nodeType === Ambient.TEXT_NODE || node.nodeName === 'BR' || node.nodeName === 'IMG') {
          clean.appendChild(node);
          continue;
        }
      } else if (Noder.isBlock(node)) {
        clean.appendChild(self.createDefaultBlock([
          this.removeFormatting(
            self, node, self._doc.createDocumentFragment())
        ]));
        continue;
      }
      this.removeFormatting(self, node, clean);
    }
    return clean;

  }

  removeAllFormatting(range): Risque {


    if (!range && !(range = this.getSelection()) || range.collapsed) {
      return this;
    }

    const root = this._root;
    let stopNode = range.commonAncestorContainer;
    while (stopNode && !Noder.isBlock(stopNode)) {
      stopNode = stopNode.parentNode;
    }
    if (!stopNode) {
      Ranger.expandRangeToBlockBoundaries(range, root);
      stopNode = root;
    }
    if (stopNode.nodeType === Ambient.TEXT_NODE) {
      return this;
    }

    // Record undo point
    this.saveUndoState(range);

    // Avoid splitting where we're already at edges.
    Ranger.moveRangeBoundariesUpTree(range, stopNode, stopNode, root);

    // Split the selection up to the block, or if whole selection in same
    // block, expand range boundaries to ends of block and split up to root.
    const doc = stopNode.ownerDocument;
    const startContainer = range.startContainer;
    let startOffset = range.startOffset;
    const endContainer = range.endContainer;
    let endOffset = range.endOffset;

    // Split end point first to avoid problems when end and start
    // in same container.
    const formattedNodes = doc.createDocumentFragment();
    const cleanNodes = doc.createDocumentFragment();
    const nodeAfterSplit = Noder.split(endContainer, endOffset, stopNode, root);
    let nodeInSplit = Noder.split(startContainer, startOffset, stopNode, root);
    let nextNode, childNodes;

    // Then replace contents in split with a cleaned version of the same:
    // blocks become default blocks, text and leaf nodes survive, everything
    // else is obliterated.
    while (nodeInSplit !== nodeAfterSplit) {
      nextNode = nodeInSplit.nextSibling;
      formattedNodes.appendChild(nodeInSplit);
      nodeInSplit = nextNode;
    }
    this.removeFormatting(this, formattedNodes, cleanNodes);
    cleanNodes.normalize();
    nodeInSplit = cleanNodes.firstChild;
    nextNode = cleanNodes.lastChild;

    // Restore selection
    childNodes = stopNode.childNodes;
    if (nodeInSplit) {
      stopNode.insertBefore(cleanNodes, nodeAfterSplit);
      startOffset = Array.prototype.indexOf.call(childNodes, nodeInSplit);
      endOffset = Array.prototype.indexOf.call(childNodes, nextNode) + 1;
    } else {
      startOffset = Array.prototype.indexOf.call(childNodes, nodeAfterSplit);
      endOffset = startOffset;
    }

    // Merge text nodes at edges, if possible
    range.setStart(stopNode, startOffset);
    range.setEnd(stopNode, endOffset);
    Noder.mergeInlines(stopNode, range);

    // And move back down the tree
    Ranger.moveRangeBoundariesDownTree(range);

    this.setSelection(range);
    this._updatePath(range, true);

    return this.focus();

  }

}

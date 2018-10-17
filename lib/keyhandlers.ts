import { Risque } from './risque';
import { Ambient } from './ambient';
import { Noder } from './noder';
import { Ranger } from './ranger';
import { Clean } from './clean';
export class KeyHandlers {

  keys: object;

  _keyMap;

  protected _editor: Risque;

  constructor(_editor: Risque) {

    this._editor = _editor;

    this.keys = {
      8: 'backspace',
      9: 'tab',
      13: 'enter',
      32: 'space',
      33: 'pageup',
      34: 'pagedown',
      37: 'left',
      39: 'right',
      46: 'delete',
      219: '[',
      221: ']'
    };

    this._keyMap = [];
    this._keyMap[Ambient.ctrlKey + 'b'] = this.mapKeyToFormat('B');
    this._keyMap[Ambient.ctrlKey + 'i'] = this.mapKeyToFormat('I');
    this._keyMap[Ambient.ctrlKey + 'u'] = this.mapKeyToFormat('U');
    this._keyMap[Ambient.ctrlKey + 'shift-7'] = this.mapKeyToFormat('S');
    this._keyMap[Ambient.ctrlKey + 'shift-5'] = this.mapKeyToFormat('SUB', { tag: 'SUP' });
    this._keyMap[Ambient.ctrlKey + 'shift-6'] = this.mapKeyToFormat('SUP', { tag: 'SUB' });
    this._keyMap[Ambient.ctrlKey + 'shift-8'] = this.mapKeyTo('makeUnorderedList');
    this._keyMap[Ambient.ctrlKey + 'shift-9'] = this.mapKeyTo('makeOrderedList');
    this._keyMap[Ambient.ctrlKey + '['] = this.mapKeyTo('decreaseQuoteLevel');
    this._keyMap[Ambient.ctrlKey + ']'] = this.mapKeyTo('increaseQuoteLevel');
    this._keyMap[Ambient.ctrlKey + 'y'] = this.mapKeyTo('redo');
    this._keyMap[Ambient.ctrlKey + 'z'] = this.mapKeyTo('undo');
    this._keyMap[Ambient.ctrlKey + 'shift-z'] = this.mapKeyTo('redo');

    this._keyMap.enter = (event, range) => {

      const root = this._editor._root;
      let block, parent, nodeAfterSplit;

      // We handle this ourselves
      event.preventDefault();

      // Save undo checkpoint and add any links in the preceding section.
      // Remove any zws so we don't think there's content in an empty
      // block.
      this._editor._recordUndoState(range);
      this._editor.addLinks(range.startContainer, root, this._editor);
      this._editor._removeZWS();
      this._editor._getRangeAndRemoveBookmark(range);

      // Selected text is overwritten, therefore delete the contents
      // to collapse selection.
      if (!range.collapsed) {
        Ranger.deleteContentsOfRange(range, root);
      }

      block = Ranger.getStartBlockOfRange(range, root);

      // If this is a malformed bit of document or in a table;
      // just play it safe and insert a <br>.
      if (!block || /^T[HD]$/.test(block.nodeName)) {
        // If inside an <a>, move focus out
        parent = Noder.getNearest(range.endContainer, root, 'A');
        if (parent) {
          parent = parent.parentNode;
          Ranger.moveRangeBoundariesUpTree(range, parent, parent, root);
          range.collapse(false);
        }
        Ranger.insertNodeInRange(range, this._editor.createElement('BR'));
        range.collapse(false);
        this._editor.setSelection(range);
        this._editor._updatePath(range, true);
        return;
      }

      // If in a list, we'll split the LI instead.
      if (parent = Noder.getNearest(block, root, 'LI')) {
        block = parent;
      }

      if (Noder.isEmptyBlock(block)) {
        // Break list
        if (Noder.getNearest(block, root, 'UL') ||
          Noder.getNearest(block, root, 'OL')) {
          return this._editor.decreaseListLevel(range);
        } else if (Noder.getNearest(block, root, 'BLOCKQUOTE')) {
          return this._editor.modifyBlocks(this._editor.removeBlockQuote, range);
        }
      }

      // Otherwise, split at cursor point.
      nodeAfterSplit = this._editor.splitBlock(this._editor, block,
        range.startContainer, range.startOffset);

      // Clean up any empty inlines if we hit enter at the beginning of the
      // block
      this._editor.removeZWS(block);
      this._editor.clean.removeEmptyInlines(block);
      Noder.fixCursor(block, root);

      // Focus cursor
      // If there's a <b>/<i> etc. at the beginning of the split
      // make sure we focus inside it.
      while (nodeAfterSplit.nodeType === Ambient.ELEMENT_NODE) {
        let child = nodeAfterSplit.firstChild,
          next;

        // Don't continue links over a block break; unlikely to be the
        // desired outcome.
        if (nodeAfterSplit.nodeName === 'A' &&
          (!nodeAfterSplit.textContent ||
            nodeAfterSplit.textContent === Ambient.ZWS)) {
          child = this._editor.doc.createTextNode('');
          Noder.replaceWith(nodeAfterSplit, child);
          nodeAfterSplit = child;
          break;
        }

        while (child && child.nodeType === Ambient.TEXT_NODE && !child.data) {
          next = child.nextSibling;
          if (!next || next.nodeName === 'BR') {
            break;
          }
          Noder.detach(child);
          child = next;
        }

        // 'BR's essentially don't count; they're a browser hack.
        // If you try to select the contents of a 'BR', FF will not let
        // you type anything!
        if (!child || child.nodeName === 'BR' ||
          (child.nodeType === Ambient.TEXT_NODE && !Ambient.isPresto)) {
          break;
        }
        nodeAfterSplit = child;
      }
      range = this._editor._createRange(nodeAfterSplit, 0);
      this._editor.setSelection(range);
      this._editor._updatePath(range, true);

    };

    // Firefox pre v29 incorrectly handles Cmd-left/Cmd-right on Mac:
    // it goes back/forward in history! Override to do the right
    // thing.
    // https://bugzilla.mozilla.org/show_bug.cgi?id=289384
    if (Ambient.isMac && Ambient.isGecko) {
      this._keyMap['meta-left'] = function (self, event) {
        event.preventDefault();
        const sel = this._editor.getWindowSelection(self);
        if (sel && sel.modify) {
          sel.modify('move', 'backward', 'lineboundary');
        }
      };
      this._keyMap['meta-right'] = function (self, event) {
        event.preventDefault();
        const sel = this._editor.getWindowSelection(self);
        if (sel && sel.modify) {
          sel.modify('move', 'forward', 'lineboundary');
        }
      };
    }

    // System standard for page up/down on Mac is to just scroll, not move the
    // cursor. On Linux/Windows, it should move the cursor, but some browsers don't
    // implement this natively. Override to support it.
    if (!Ambient.isMac) {
      this._keyMap.pageup = function (self) {
        self.moveCursorToStart();
      };
      this._keyMap.pagedown = function (self) {
        self.moveCursorToEnd();
      };
    }

    this._editor = _editor;
  }

  // Ref: http://unixpapa.com/js/key.html
  onKey(event) {
    const code = event.keyCode,
      range = this._editor.getSelection();
    let key = this.keys[code],
      modifiers = '';

    if (event.defaultPrevented) {
      return;
    }

    if (!key) {
      key = String.fromCharCode(code).toLowerCase();
      // Only reliable for letters and numbers
      if (!/^[A-Za-z0-9]$/.test(key)) {
        key = '';
      }
    }

    // On keypress, delete and '.' both have event.keyCode 46
    // Must check event.which to differentiate.
    if (Ambient.isPresto && event.which === 46) {
      key = '.';
    }

    // Function keys
    if (111 < code && code < 124) {
      key = 'f' + (code - 111);
    }

    // We need to apply the backspace/delete handlers regardless of
    // control key modifiers.
    if (key !== 'backspace' && key !== 'delete') {
      if (event.altKey) { modifiers += 'alt-'; }
      if (event.ctrlKey) { modifiers += 'ctrl-'; }
      if (event.metaKey) { modifiers += 'meta-'; }
    }
    // However, on Windows, shift-delete is apparently "cut" (WTF right?), so
    // we want to let the browser handle shift-delete.
    if (event.shiftKey) { modifiers += 'shift-'; }

    key = modifiers + key;

    if (this._keyMap[key]) {
      this._keyMap[key](this, event, range);
    } else if (!range.collapsed && !event.ctrlKey && !event.metaKey &&
      (event.key || key).length === 1) {
      // Record undo checkpoint.
      this._editor.saveUndoState(range);
      // Delete the selection
      Ranger.deleteContentsOfRange(range, this._editor._root);
      this._editor._ensureBottomLine();
      this._editor.setSelection(range);
      this._editor._updatePath(range, true);
    }
  }

  mapKeyTo(method) {

    return function (self, event) {
      event.preventDefault();
      self[method]();
    };
  }

  mapKeyToFormat(tag, remove?) {

    remove = remove || null;
    return function (self, event) {
      event.preventDefault();
      const range = self.getSelection();
      if (self.hasFormat(tag, null, range)) {
        self.changeFormat(null, { tag: tag }, range);
      } else {
        self.changeFormat({ tag: tag }, remove, range);
      }
    };
  }

  // If you delete the content inside a span with a font styling, Webkit will
  // replace it with a <font> tag (!). If you delete all the text inside a
  // link in Opera, it won't delete the link. Let's make things consistent. If
  // you delete all text inside an inline tag, remove the inline tag.
  afterDelete(self, range) {

    try {
      if (!range) { range = self.getSelection(); }
      let node = range.startContainer,
        parent;
      // Climb the tree from the focus point while we are inside an empty
      // inline element
      if (node.nodeType === Ambient.TEXT_NODE) {
        node = node.parentNode;
      }
      parent = node;
      while (Noder.isInline(parent) &&
        (!parent.textContent || parent.textContent === Ambient.ZWS)) {
        node = parent;
        parent = node.parentNode;
      }
      // If focused in empty inline element
      if (node !== parent) {
        // Move focus to just before empty inline(s)
        range.setStart(parent,
          Array.prototype.indexOf.call(parent.childNodes, node));
        range.collapse(true);
        // Remove empty inline(s)
        parent.removeChild(node);
        // Fix cursor in block
        if (!Noder.isBlock(parent)) {
          parent = Noder.getPreviousBlock(parent, self._root);
        }
        Noder.fixCursor(parent, self._root);
        // Move cursor into text node
        Ranger.moveRangeBoundariesDownTree(range);
      }
      // If you delete the last character in the sole <div> in Chrome,
      // it removes the div and replaces it with just a <br> inside the
      // root. Detach the <br>; the _ensureBottomLine call will insert a new
      // block.
      if (node === self._root &&
        (node = node.firstChild) && node.nodeName === 'BR') {
        Noder.detach(node);
      }
      self._ensureBottomLine();
      self.setSelection(range);
      self._updatePath(range, true);
    } catch (error) {
      self.didError(error);
    }
  }

}

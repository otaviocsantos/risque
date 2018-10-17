import { Ambient } from './ambient';
import { Clean } from './clean';
import { Noder } from './noder';
import { Ranger } from './ranger';
import { Risque } from './risque';

export class Clipboard {

  _editor: Risque;

  constructor(_editor: Risque) {
    this._editor = _editor;
  }
  // The (non-standard but supported enough) innerText property is based on the
  // render tree in Firefox and possibly other browsers, so we must insert the
  // DOM node into the document to ensure the text part is correct.
  setClipboardData(clipboardData, node, root) {
    const body = node.ownerDocument.body;
    let html, text;

    // Firefox will add an extra new line for BRs at the end of block when
    // calculating innerText, even though they don't actually affect display.
    // So we need to remove them first.
    this._editor.clean.cleanupBRs(node, root, true);

    node.setAttribute('style',
      'position:fixed;overflow:hidden;bottom:100%;right:100%;');
    body.appendChild(node);
    html = node.innerHTML;
    text = node.innerText || node.textContent;

    // Firefox (and others?) returns unix line endings (\n) even on Windows.
    // If on Windows, normalise to \r\n, since Notepad and some other crappy
    // apps do not understand just \n.
    if (Ambient.isWin) {
      text = text.replace(/\r?\n/g, '\r\n');
    }

    clipboardData.setData('text/html', html);
    clipboardData.setData('text/plain', text);

    body.removeChild(node);
  }

  onCut(event) {
    const clipboardData = event.clipboardData;
    const range = this._editor.getSelection();
    const root = this._editor._root;
    const self = this;
    let startBlock, endBlock, copyRoot, contents, parent, newContents, node;

    // Nothing to do
    if (range.collapsed) {
      event.preventDefault();
      return;
    }

    // Save undo checkpoint
    this._editor.saveUndoState(range);

    // Edge only seems to support setting plain text as of 2016-03-11.
    // Mobile Safari flat out doesn't work:
    // https://bugs.webkit.org/show_bug.cgi?id=143776
    if (!Ambient.isEdge && !Ambient.isIOS && clipboardData) {
      // Clipboard content should include all parents within block, or all
      // parents up to root if selection across blocks
      startBlock = Ranger.getStartBlockOfRange(range, root);
      endBlock = Ranger.getEndBlockOfRange(range, root);
      copyRoot = ((startBlock === endBlock) && startBlock) || root;
      // Extract the contents
      contents = Ranger.deleteContentsOfRange(range, root);
      // Add any other parents not in extracted content, up to copy root
      parent = range.commonAncestorContainer;
      if (parent.nodeType === Ambient.TEXT_NODE) {
        parent = parent.parentNode;
      }
      while (parent && parent !== copyRoot) {
        newContents = parent.cloneNode(false);
        newContents.appendChild(contents);
        contents = newContents;
        parent = parent.parentNode;
      }
      // Set clipboard data
      node = this._editor.createElement('div');
      node.appendChild(contents);
      this.setClipboardData(clipboardData, node, root);
      event.preventDefault();
    } else {
      setTimeout(function () {
        try {
          // If all content removed, ensure div at start of root.
          self._editor._ensureBottomLine();
        } catch (error) {
          self._editor.didError(error);
        }
      }, 0);
    }

    this._editor.setSelection(range);
  }

  onCopy(event) {
    const clipboardData = event.clipboardData;
    let range = this._editor.getSelection();
    const root = this._editor._root;
    let startBlock, endBlock, copyRoot, contents, parent, newContents, node;

    // Edge only seems to support setting plain text as of 2016-03-11.
    // Mobile Safari flat out doesn't work:
    // https://bugs.webkit.org/show_bug.cgi?id=143776
    if (!Ambient.isEdge && !Ambient.isIOS && clipboardData) {
      // Clipboard content should include all parents within block, or all
      // parents up to root if selection across blocks
      startBlock = Ranger.getStartBlockOfRange(range, root);
      endBlock = Ranger.getEndBlockOfRange(range, root);
      copyRoot = ((startBlock === endBlock) && startBlock) || root;
      // Clone range to mutate, then move up as high as possible without
      // passing the copy root node.
      range = range.cloneRange();
      Ranger.moveRangeBoundariesDownTree(range);
      Ranger.moveRangeBoundariesUpTree(range, copyRoot, copyRoot, root);
      // Extract the contents
      contents = range.cloneContents();
      // Add any other parents not in extracted content, up to copy root
      parent = range.commonAncestorContainer;
      if (parent.nodeType === Ambient.TEXT_NODE) {
        parent = parent.parentNode;
      }
      while (parent && parent !== copyRoot) {
        newContents = parent.cloneNode(false);
        newContents.appendChild(contents);
        contents = newContents;
        parent = parent.parentNode;
      }
      // Set clipboard data
      node = this._editor.createElement('div');
      node.appendChild(contents);
      this.setClipboardData(clipboardData, node, root);
      event.preventDefault();
    }
  }

  // Need to monitor for shift key like this, as event.shiftKey is not available
  // in paste event.
  monitorShiftKey(event) {
    this._editor.isShiftDown = event.shiftKey;
  }

  onPaste(event) {
    const clipboardData = event.clipboardData;
    let items = clipboardData && clipboardData.items;
    const choosePlain = this._editor.isShiftDown;
    let fireDrop = false;
    let hasImage = false;
    let plainItem = null;
    const self = this;
    let l, item, type, types, data;

    // Current HTML5 Clipboard interface
    // ---------------------------------
    // https://html.spec.whatwg.org/multipage/interaction.html

    // Edge only provides access to plain text as of 2016-03-11 and gives no
    // indication there should be an HTML part. However, it does support access
    // to image data, so check if this is present and use if so.
    if (Ambient.isEdge && items) {
      l = items.length;
      while (l--) {
        if (!choosePlain && /^image\/.*/.test(items[l].type)) {
          hasImage = true;
        }
      }
      if (!hasImage) {
        items = null;
      }
    }
    if (items) {
      event.preventDefault();
      l = items.length;
      while (l--) {
        item = items[l];
        type = item.type;
        if (!choosePlain && type === 'text/html') {
          /*jshint loopfunc: true */
          item.getAsString(function (html) {
            self._editor.insertHTML(html, true);
          });
          /*jshint loopfunc: false */
          return;
        }
        if (type === 'text/plain') {
          plainItem = item;
        }
        if (!choosePlain && /^image\/.*/.test(type)) {
          hasImage = true;
        }
      }
      // Treat image paste as a drop of an image file.
      if (hasImage) {
        this._editor.fireEvent('dragover', {
          dataTransfer: clipboardData,
          /*jshint loopfunc: true */
          preventDefault: function () {
            fireDrop = true;
          }
          /*jshint loopfunc: false */
        });
        if (fireDrop) {
          this._editor.fireEvent('drop', {
            dataTransfer: clipboardData
          });
        }
      } else if (plainItem) {
        plainItem.getAsString(function (text) {
          self._editor.insertPlainText(text, true);
        });
      }
      return;
    }

    // Old interface
    // -------------

    // Safari (and indeed many other OS X apps) copies stuff as text/rtf
    // rather than text/html; even from a webpage in Safari. The only way
    // to get an HTML version is to fallback to letting the browser insert
    // the content. Same for getting image data. *Sigh*.
    //
    // Firefox is even worse: it doesn't even let you know that there might be
    // an RTF version on the clipboard, but it will also convert to HTML if you
    // let the browser insert the content. I've filed
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1254028
    types = clipboardData && clipboardData.types;
    if (!Ambient.isEdge && types && (
      Array.prototype.indexOf.call(types, 'text/html') > -1 || (
        !Ambient.isGecko &&
        Array.prototype.indexOf.call(types, 'text/plain') > -1 &&
        Array.prototype.indexOf.call(types, 'text/rtf') < 0)
    )) {
      event.preventDefault();
      // Abiword on Linux copies a plain text and html version, but the HTML
      // version is the empty string! So always try to get HTML, but if none,
      // insert plain text instead. On iOS, Facebook (and possibly other
      // apps?) copy links as type text/uri-list, but also insert a **blank**
      // text/plain item onto the clipboard. Why? Who knows.
      if (!choosePlain && (data = clipboardData.getData('text/html'))) {
        this._editor.insertHTML(data, true);
      } else if (
        (data = clipboardData.getData('text/plain')) ||
        (data = clipboardData.getData('text/uri-list'))) {
        this._editor.insertPlainText(data, true);
      }
      return;
    }

    // No interface. Includes all versions of IE :(
    // --------------------------------------------

    this._editor._awaitingPaste = true;

    const body = this._editor.doc.body,
      range = this._editor.getSelection(),
      startContainer = range.startContainer,
      startOffset = range.startOffset,
      endContainer = range.endContainer,
      endOffset = range.endOffset;

    // We need to position the pasteArea in the visible portion of the screen
    // to stop the browser auto-scrolling.
    let pasteArea = this._editor.createElement('DIV', {
      contenteditable: 'true',
      style: 'position:fixed; overflow:hidden; top:0; right:100%; width:1px; height:1px;'
    });
    body.appendChild(pasteArea);
    range.selectNodeContents(pasteArea);
    this._editor.setSelection(range);

    // A setTimeout of 0 means this is added to the back of the
    // single javascript thread, so it will be executed after the
    // paste event.
    setTimeout(function () {
      try {
        // IE sometimes fires the beforepaste event twice; make sure it is
        // not run again before our after paste function is called.
        self._editor._awaitingPaste = false;

        // Get the pasted content and clean
        let html = '',
          next = pasteArea,
          first, teimeoutRange;

        // #88: Chrome can apparently split the paste area if certain
        // content is inserted; gather them all up.
        while (pasteArea = next) {
          next = pasteArea.nextSibling;
          Noder.detach(pasteArea);
          // Safari and IE like putting extra divs around things.
          first = pasteArea.firstChild;
          if (first && first === pasteArea.lastChild &&
            first.nodeName === 'DIV') {
            pasteArea = first;
          }
          html += pasteArea.innerHTML;
        }

        teimeoutRange = self._editor._createRange(
          startContainer, startOffset, endContainer, endOffset);
        self._editor.setSelection(teimeoutRange);

        if (html) {
          self._editor.insertHTML(html, true);
        }
      } catch (error) {
        self._editor.didError(error);
      }
    }, 0);
  }

  // On Windows you can drag an drop text. We can't handle this ourselves, because
  // as far as I can see, there's no way to get the drop insertion point. So just
  // save an undo state and hope for the best.
  onDrop(event) {
    const types = event.dataTransfer.types;
    let l = types.length;
    let hasPlain = false;
    let hasHTML = false;
    while (l--) {
      switch (types[l]) {
        case 'text/plain':
          hasPlain = true;
          break;
        case 'text/html':
          hasHTML = true;
          break;
        default:
          return;
      }
    }
    if (hasHTML || hasPlain) {
      this._editor.saveUndoState();
    }
  }
}

import { Ambient } from './ambient';
import { TreeWalker } from './tree-walker';

export class Noder {

  static inlineNodeNames = /^(?:#text|A(?:BBR|CRONYM)?|B(?:R|D[IO])?|C(?:ITE|ODE)|D(?:ATA|EL|FN)|EM|FONT|HR|I(?:FRAME|MG|NPUT|NS)?|KBD|Q|R(?:P|T|UBY)|S(?:AMP|MALL|PAN|TR(?:IKE|ONG)|U[BP])?|TIME|U|VAR|WBR)$/;

  static leafNodeNames = {
    BR: 1,
    HR: 1,
    IFRAME: 1,
    IMG: 1,
    INPUT: 1
  };

  static readonly UNKNOWN = 0;
  static readonly INLINE = 1;
  static readonly BLOCK = 2;
  static readonly CONTAINER = 3;

  static readonly nodeCategoryCache = Ambient.canWeakMap ? new WeakMap() : null;

  static every(nodeList, fn) {
    let l = nodeList.length;
    while (l--) {
      if (!fn(nodeList[l])) {
        return false;
      }
    }
    return true;
  }

  // ---

  static isLeaf(node) {
    return node.nodeType === Ambient.ELEMENT_NODE && !!Noder.leafNodeNames[node.nodeName];
  }
  static getNodeCategory(node) {
    switch (node.nodeType) {
      case Ambient.TEXT_NODE:
        return Noder.INLINE;
      case Ambient.ELEMENT_NODE:
      case Ambient.DOCUMENT_FRAGMENT_NODE:
        if (Ambient.canWeakMap && Noder.nodeCategoryCache.has(node)) {
          return Noder.nodeCategoryCache.get(node);
        }
        break;
      default:
        return Noder.UNKNOWN;
    }

    let nodeCategory;
    if (!Noder.every(node.childNodes, Noder.isInline)) {
      // Malformed HTML can have block tags inside inline tags. Need to treat
      // these as containers rather than inline. See #239.
      nodeCategory = Noder.CONTAINER;
    } else if (Noder.inlineNodeNames.test(node.nodeName)) {
      nodeCategory = Noder.INLINE;
    } else {
      nodeCategory = Noder.BLOCK;
    }
    if (Ambient.canWeakMap) {
      Noder.nodeCategoryCache.set(node, nodeCategory);
    }
    return nodeCategory;
  }
  static isInline(node) {
    return Noder.getNodeCategory(node) === Noder.INLINE;
  }
  static isBlock(node) {
    return Noder.getNodeCategory(node) === Noder.BLOCK;
  }
  static isContainer(node) {
    return Noder.getNodeCategory(node) === Noder.CONTAINER;
  }

  static getBlockWalker(node, root) {
    const walker = new TreeWalker(root, Ambient.SHOW_ELEMENT, Noder.isBlock);
    walker.currentNode = node;
    return walker;
  }
  static getPreviousBlock(node, root) {
    node = Noder.getBlockWalker(node, root).previousNode();
    return node !== root ? node : null;
  }
  static getNextBlock(node, root?) {
    node = Noder.getBlockWalker(node, root).nextNode();
    return node !== root ? node : null;
  }

  static isEmptyBlock(block) {
    return !block.textContent && !block.querySelector('IMG');
  }

  static areAlike(node, node2) {
    return !Noder.isLeaf(node) && (
      node.nodeType === node2.nodeType &&
      node.nodeName === node2.nodeName &&
      node.nodeName !== 'A' &&
      node.className === node2.className &&
      ((!node.style && !node2.style) ||
        node.style.cssText === node2.style.cssText)
    );
  }
  static hasTagAttributes(node, tag, attributes) {
    if (node.nodeName !== tag) {
      return false;
    }
    for (const attr in attributes) {
      if (node.getAttribute(attr) !== attributes[attr]) {
        return false;
      }
    }
    return true;
  }
  static getNearest(node, root, tag, attributes?) {
    while (node && node !== root) {
      if (Noder.hasTagAttributes(node, tag, attributes)) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }
  static isOrContains(parent, node) {
    while (node) {
      if (node === parent) {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  static getPath(node, root) {

    let path = '';
    let id, className, classNames, dir;
    if (node && node !== root) {
      path = Noder.getPath(node.parentNode, root);
      if (node.nodeType === Ambient.ELEMENT_NODE) {
        path += (path ? '>' : '') + node.nodeName;
        if (id = node.id) {
          path += '#' + id;
        }
        if (className = node.className.trim()) {
          classNames = className.split(/\s\s*/);
          classNames.sort();
          path += '.';
          path += classNames.join('.');
        }
        if (dir = node.dir) {
          path += '[dir=' + dir + ']';
        }
        if (classNames) {
          if (Array.prototype.indexOf.call(classNames, Ambient.BACKGROUND_COLOR_CLASS) > -1) {
            path += '[backgroundColor=' +
              node.style.backgroundColor.replace(/ /g, '') + ']';
          }
          if (Array.prototype.indexOf.call(classNames, Ambient.COLOR_CLASS) > -1) {
            path += '[color=' +
              node.style.color.replace(/ /g, '') + ']';
          }
          if (Array.prototype.indexOf.call(classNames, Ambient.FONT_FAMILY_CLASS) > -1) {
            path += '[fontFamily=' +
              node.style.fontFamily.replace(/ /g, '') + ']';
          }
          if (Array.prototype.indexOf.call(classNames, Ambient.FONT_SIZE_CLASS) > -1) {
            path += '[fontSize=' + node.style.fontSize + ']';
          }
        }
      }
    }
    return path;
  }

  static getLength(node) {
    const nodeType = node.nodeType;
    return nodeType === Ambient.ELEMENT_NODE || nodeType === Ambient.DOCUMENT_FRAGMENT_NODE ?
      node.childNodes.length : node.length || 0;
  }

  static detach(node) {
    const parent = node.parentNode;
    if (parent) {
      parent.removeChild(node);
    }
    return node;
  }
  static replaceWith(node, node2) {
    const parent = node.parentNode;
    if (parent) {
      parent.replaceChild(node2, node);
    }
  }
  static empty(node) {

    const frag = node.ownerDocument.createDocumentFragment(),
      childNodes = node.childNodes;
    let l = childNodes ? childNodes.length : 0;

    while (l--) {
      frag.appendChild(node.firstChild);
    }
    return frag;

  }

  static createElement(doc, tag, props?, children?) {
    let i, l;
    const el = doc.createElement(tag);

    if (props instanceof Array) {
      children = props;
      props = null;
    }
    if (props) {
      for (const [key, value] of Object.entries(props)) {

        if (value !== undefined) {
          el.setAttribute(key, value);
        }
      }
    }
    if (children) {
      for (i = 0, l = children.length; i < l; i += 1) {
        el.appendChild(children[i]);
      }
    }
    return el;
  }

  static fixCursor(node, root) {
    // In Webkit and Gecko, block level elements are collapsed and
    // unfocussable if they have no content. To remedy this, a <BR> must be
    // inserted. In Opera and IE, we just need a textnode in order for the
    // cursor to appear.
    const self = root.__squire__;
    const doc = node.ownerDocument;
    const originalNode = node;
    let fixer, child;

    if (node === root) {
      if (!(child = node.firstChild) || child.nodeName === 'BR') {
        fixer = self.createDefaultBlock();
        if (child) {
          node.replaceChild(fixer, child);
        } else {
          node.appendChild(fixer);
        }
        node = fixer;
        fixer = null;
      }
    }

    if (node.nodeType === Ambient.TEXT_NODE) {
      return originalNode;
    }

    if (Noder.isInline(node)) {
      child = node.firstChild;
      while (Ambient.cantFocusEmptyTextNodes && child &&
        child.nodeType === Ambient.TEXT_NODE && !child.data) {
        node.removeChild(child);
        child = node.firstChild;
      }
      if (!child) {
        if (Ambient.cantFocusEmptyTextNodes) {
          fixer = doc.createTextNode(Ambient.ZWS);
          self._didAddZWS();
        } else {
          fixer = doc.createTextNode('');
        }
      }
    } else {
      if (Ambient.useTextFixer) {
        while (node.nodeType !== Ambient.TEXT_NODE && !Noder.isLeaf(node)) {
          child = node.firstChild;
          if (!child) {
            fixer = doc.createTextNode('');
            break;
          }
          node = child;
        }
        if (node.nodeType === Ambient.TEXT_NODE) {
          // Opera will collapse the block element if it contains
          // just spaces (but not if it contains no data at all).
          if (/^ +$/.test(node.data)) {
            node.data = '';
          }
        } else if (Noder.isLeaf(node)) {
          node.parentNode.insertBefore(doc.createTextNode(''), node);
        }
      } else if (!node.querySelector('BR')) {
        fixer = Noder.createElement(doc, 'BR');
        while ((child = node.lastElementChild) && !Noder.isInline(child)) {
          node = child;
        }
      }
    }
    if (fixer) {
      try {
        node.appendChild(fixer);
      } catch (error) {
        self.didError({
          name: 'Squire: fixCursor – ' + error,
          message: 'Parent: ' + node.nodeName + '/' + node.innerHTML +
            ' appendChild: ' + fixer.nodeName
        });
      }
    }

    return originalNode;
  }

  // Recursively examine container nodes and wrap any inline children.
  static fixContainer(container, root) {
    const children = container.childNodes;
    const doc = container.ownerDocument;
    let wrapper = null;
    let i, l, child, isBR;
    const config = root.__squire__._config;

    for (i = 0, l = children.length; i < l; i += 1) {
      child = children[i];
      isBR = child.nodeName === 'BR';
      if (!isBR && Noder.isInline(child)) {
        if (!wrapper) {
          wrapper = Noder.createElement(doc,
            config.blockTag, config.blockAttributes);
        }
        wrapper.appendChild(child);
        i -= 1;
        l -= 1;
      } else if (isBR || wrapper) {
        if (!wrapper) {
          wrapper = Noder.createElement(doc,
            config.blockTag, config.blockAttributes);
        }
        Noder.fixCursor(wrapper, root);
        if (isBR) {
          container.replaceChild(wrapper, child);
        } else {
          container.insertBefore(wrapper, child);
          i += 1;
          l += 1;
        }
        wrapper = null;
      }
      if (Noder.isContainer(child)) {
        Noder.fixContainer(child, root);
      }
    }
    if (wrapper) {
      container.appendChild(Noder.fixCursor(wrapper, root));
    }
    return container;
  }

  static split(node, offset, stopNode, root) {
    const nodeType = node.nodeType;
    let parent, clone, next;
    if (nodeType === Ambient.TEXT_NODE && node !== stopNode) {
      return Noder.split(
        node.parentNode, node.splitText(offset), stopNode, root);
    }
    if (nodeType === Ambient.ELEMENT_NODE) {
      if (typeof (offset) === 'number') {
        offset = offset < node.childNodes.length ?
          node.childNodes[offset] : null;
      }
      if (node === stopNode) {
        return offset;
      }

      // Clone node without children
      parent = node.parentNode;
      clone = node.cloneNode(false);

      // Add right-hand siblings to the clone
      while (offset) {
        next = offset.nextSibling;
        clone.appendChild(offset);
        offset = next;
      }

      // Maintain li numbering if inside a quote.
      if (node.nodeName === 'OL' &&
        Noder.getNearest(node, root, 'BLOCKQUOTE')) {
        clone.start = (+node.start || 1) + node.childNodes.length - 1;
      }

      // DO NOT NORMALISE. This may undo the fixCursor() call
      // of a node lower down the tree!

      // We need something in the element in order for the cursor to appear.
      Noder.fixCursor(node, root);
      Noder.fixCursor(clone, root);

      // Inject clone after original node
      if (next = node.nextSibling) {
        parent.insertBefore(clone, next);
      } else {
        parent.appendChild(clone);
      }

      // Keep on splitting up the tree
      return Noder.split(parent, clone, stopNode, root);
    }
    return offset;
  }

  static _mergeInlines(node, fakeRange) {
    const children = node.childNodes,
      frags = [];
    let l = children.length,
      child, prev, len;
    while (l--) {
      child = children[l];
      prev = l && children[l - 1];
      if (l && Noder.isInline(child) && Noder.areAlike(child, prev) &&
        !Noder.leafNodeNames[child.nodeName]) {
        if (fakeRange.startContainer === child) {
          fakeRange.startContainer = prev;
          fakeRange.startOffset += Noder.getLength(prev);
        }
        if (fakeRange.endContainer === child) {
          fakeRange.endContainer = prev;
          fakeRange.endOffset += Noder.getLength(prev);
        }
        if (fakeRange.startContainer === node) {
          if (fakeRange.startOffset > l) {
            fakeRange.startOffset -= 1;
          } else if (fakeRange.startOffset === l) {
            fakeRange.startContainer = prev;
            fakeRange.startOffset = Noder.getLength(prev);
          }
        }
        if (fakeRange.endContainer === node) {
          if (fakeRange.endOffset > l) {
            fakeRange.endOffset -= 1;
          } else if (fakeRange.endOffset === l) {
            fakeRange.endContainer = prev;
            fakeRange.endOffset = Noder.getLength(prev);
          }
        }
        Noder.detach(child);
        if (child.nodeType === Ambient.TEXT_NODE) {
          prev.appendData(child.data);
        } else {
          frags.push(Noder.empty(child));
        }
      } else if (child.nodeType === Ambient.ELEMENT_NODE) {
        len = frags.length;
        while (len--) {
          child.appendChild(frags.pop());
        }
        Noder._mergeInlines(child, fakeRange);
      }
    }
  }

  static mergeInlines(node, range) {
    if (node.nodeType === Ambient.TEXT_NODE) {
      node = node.parentNode;
    }
    if (node.nodeType === Ambient.ELEMENT_NODE) {
      const fakeRange = {
        startContainer: range.startContainer,
        startOffset: range.startOffset,
        endContainer: range.endContainer,
        endOffset: range.endOffset
      };
      Noder._mergeInlines(node, fakeRange);
      range.setStart(fakeRange.startContainer, fakeRange.startOffset);
      range.setEnd(fakeRange.endContainer, fakeRange.endOffset);
    }
  }

  static mergeWithBlock(block, next, range, root) {
    let container = next;
    let parent, last, offset;
    while ((parent = container.parentNode) &&
      parent !== root &&
      parent.nodeType === Ambient.ELEMENT_NODE &&
      parent.childNodes.length === 1) {
      container = parent;
    }
    Noder.detach(container);

    offset = block.childNodes.length;

    // Remove extra <BR> fixer if present.
    last = block.lastChild;
    if (last && last.nodeName === 'BR') {
      block.removeChild(last);
      offset -= 1;
    }

    block.appendChild(Noder.empty(next));

    range.setStart(block, offset);
    range.collapse(true);
    Noder.mergeInlines(block, range);

    // Opera inserts a BR if you delete the last piece of text
    // in a block-level element. Unfortunately, it then gets
    // confused when setting the selection subsequently and
    // refuses to accept the range that finishes just before the
    // BR. Removing the BR fixes the bug.
    // Steps to reproduce bug: Type "a-b-c" (where - is return)
    // then backspace twice. The cursor goes to the top instead
    // of after "b".
    if (Ambient.isPresto && (last = block.lastChild) && last.nodeName === 'BR') {
      block.removeChild(last);
    }
  }

  static mergeContainers(node, root) {
    let prev = node.previousSibling,
      needsFix, block;
    const isListItem = (node.nodeName === 'LI'),
      first = node.firstChild,
      doc = node.ownerDocument;

    // Do not merge LIs, unless it only contains a UL
    if (isListItem && (!first || !/^[OU]L$/.test(first.nodeName))) {
      return;
    }

    if (prev && Noder.areAlike(prev, node)) {
      if (!Noder.isContainer(prev)) {
        if (isListItem) {
          block = Noder.createElement(doc, 'DIV');
          block.appendChild(Noder.empty(prev));
          prev.appendChild(block);
        } else {
          return;
        }
      }
      Noder.detach(node);
      needsFix = !Noder.isContainer(node);
      prev.appendChild(Noder.empty(node));
      if (needsFix) {
        Noder.fixContainer(prev, root);
      }
      if (first) {
        Noder.mergeContainers(first, root);
      }
    } else if (isListItem) {
      prev = Noder.createElement(doc, 'DIV');
      node.insertBefore(prev, first);
      Noder.fixCursor(prev, root);
    }
  }
}

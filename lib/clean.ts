import { Ambient } from './ambient';
import { Noder } from './noder';
import { TreeWalker } from './tree-walker';

export class Clean {
  fontSizes = {
    1: 10,
    2: 13,
    3: 16,
    4: 18,
    5: 24,
    6: 32,
    7: 48
  };

  allowedBlock = /^(?:A(?:DDRESS|RTICLE|SIDE|UDIO)|BLOCKQUOTE|CAPTION|D(?:[DLT]|IV)|F(?:IGURE|IGCAPTION|OOTER)|H[1-6]|HEADER|L(?:ABEL|EGEND|I)|O(?:L|UTPUT)|P(?:RE)?|SECTION|T(?:ABLE|BODY|D|FOOT|H|HEAD|R)|COL(?:GROUP)?|UL)$/;

  blacklist = /^(?:HEAD|META|STYLE)/;

  stylesRewriters = {
    P: this.replaceStyles,
    SPAN: this.replaceStyles,
    STRONG: this.replaceWithTag('B'),
    EM: this.replaceWithTag('I'),
    INS: this.replaceWithTag('U'),
    STRIKE: this.replaceWithTag('S'),
    FONT: function (node, parent) {
      const face = node.face,
        size = node.size,
        doc = node.ownerDocument;
      let colour = node.color,
        fontSpan, sizeSpan, colourSpan,
        newTreeBottom, newTreeTop;
      if (face) {
        fontSpan = Noder.createElement(doc, 'SPAN', {
          'class': Ambient.FONT_FAMILY_CLASS,
          style: 'font-family:' + face
        });
        newTreeTop = fontSpan;
        newTreeBottom = fontSpan;
      }
      if (size) {
        sizeSpan = Noder.createElement(doc, 'SPAN', {
          'class': Ambient.FONT_SIZE_CLASS,
          style: 'font-size:' + this.fontSizes[size] + 'px'
        });
        if (!newTreeTop) {
          newTreeTop = sizeSpan;
        }
        if (newTreeBottom) {
          newTreeBottom.appendChild(sizeSpan);
        }
        newTreeBottom = sizeSpan;
      }
      if (colour && /^#?([\dA-F]{3}){1,2}$/i.test(colour)) {
        if (colour.charAt(0) !== '#') {
          colour = '#' + colour;
        }
        colourSpan = Noder.createElement(doc, 'SPAN', {
          'class': Ambient.COLOR_CLASS,
          style: 'color:' + colour
        });
        if (!newTreeTop) {
          newTreeTop = colourSpan;
        }
        if (newTreeBottom) {
          newTreeBottom.appendChild(colourSpan);
        }
        newTreeBottom = colourSpan;
      }
      if (!newTreeTop) {
        newTreeTop = newTreeBottom = Noder.createElement(doc, 'SPAN');
      }
      parent.replaceChild(newTreeTop, node);
      newTreeBottom.appendChild(Noder.empty(node));
      return newTreeBottom;
    },
    TT: function (node, parent) {
      const el = Noder.createElement(node.ownerDocument, 'SPAN', {
        'class': Ambient.FONT_FAMILY_CLASS,
        style: 'font-family:menlo,consolas,"courier new",monospace'
      });
      parent.replaceChild(el, node);
      el.appendChild(Noder.empty(node));
      return el;
    }
  };


  styleToSemantic = {
    backgroundColor: {
      regexp: Ambient.notWS,
      replace: function (doc, colour) {
        return Noder.createElement(doc, 'SPAN', {
          'class': Ambient.BACKGROUND_COLOR_CLASS,
          style: 'background-color:' + colour
        });
      }
    },
    color: {
      regexp: Ambient.notWS,
      replace: function (doc, colour) {
        return Noder.createElement(doc, 'SPAN', {
          'class': Ambient.COLOR_CLASS,
          style: 'color:' + colour
        });
      }
    },
    fontWeight: {
      regexp: /^bold|^700/i,
      replace: function (doc) {
        return Noder.createElement(doc, 'B');
      }
    },
    fontStyle: {
      regexp: /^italic/i,
      replace: function (doc) {
        return Noder.createElement(doc, 'I');
      }
    },
    fontFamily: {
      regexp: Ambient.notWS,
      replace: function (doc, family) {
        return Noder.createElement(doc, 'SPAN', {
          'class': Ambient.FONT_FAMILY_CLASS,
          style: 'font-family:' + family
        });
      }
    },
    fontSize: {
      regexp: Ambient.notWS,
      replace: function (doc, size) {
        return Noder.createElement(doc, 'SPAN', {
          'class': Ambient.FONT_SIZE_CLASS,
          style: 'font-size:' + size
        });
      }
    },
    textDecoration: {
      regexp: /^underline/i,
      replace: function (doc) {
        return Noder.createElement(doc, 'U');
      }
    }
  };

  walker = new TreeWalker(null, Ambient.SHOW_TEXT | Ambient.SHOW_ELEMENT, function () {
    return true;
  });

  // <br> elements are treated specially, and differently depending on the
  // browser, when in rich text editor mode. When adding HTML from external
  // sources, we must remove them, replacing the ones that actually affect
  // line breaks by wrapping the inline text in a <div>. Browsers that want <br>
  // elements at the end of each block will then have them added back in a later
  // fixCursor method call.
  cleanupBRs(node, root, keepForBlankLine) {

    const brs = node.querySelectorAll('BR');
    const brBreaksLine = [];
    let l = brs.length;
    let i, br, parent;

    // Must calculate whether the <br> breaks a line first, because if we
    // have two <br>s next to each other, after the first one is converted
    // to a block split, the second will be at the end of a block and
    // therefore seem to not be a line break. But in its original context it
    // was, so we should also convert it to a block split.
    for (i = 0; i < l; i += 1) {
      brBreaksLine[i] = this.isLineBreak(brs[i], keepForBlankLine);
    }
    while (l--) {
      br = brs[l];
      // Cleanup may have removed it
      parent = br.parentNode;
      if (!parent) { continue; }
      // If it doesn't break a line, just remove it; it's not doing
      // anything useful. We'll add it back later if required by the
      // browser. If it breaks a line, wrap the content in div tags
      // and replace the brs.
      if (!brBreaksLine[l]) {
        Noder.detach(br);
      } else if (!Noder.isInline(parent)) {
        Noder.fixContainer(parent, root);
      }
    }
  }

  isLineBreak(br, isLBIfEmptyBlock) {
    let block = br.parentNode;
    let walker;
    while (Noder.isInline(block)) {
      block = block.parentNode;
    }
    walker = new TreeWalker(
      block, Ambient.SHOW_ELEMENT | Ambient.SHOW_TEXT, this.notWSTextNode);
    walker.currentNode = br;
    return !!walker.nextNode() ||
      (isLBIfEmptyBlock && !walker.previousNode());
  }

  notWSTextNode(node) {
    return node.nodeType === Ambient.ELEMENT_NODE ?
      node.nodeName === 'BR' :
      Ambient.notWS.test(node.data);
  }


  replaceWithTag(tag) {
    return function (node, parent) {
      const el = Noder.createElement(node.ownerDocument, tag);
      parent.replaceChild(el, node);
      el.appendChild(Noder.empty(node));
      return el;
    };
  }

  replaceStyles(node, parent) {
    const style = node.style;
    const doc = node.ownerDocument;
    let attr, converter, css, newTreeBottom, newTreeTop, el;

    for (attr of Object.keys(this.styleToSemantic)) {
      converter = this.styleToSemantic[attr];
      css = style[attr];
      if (css && converter.regexp.test(css)) {
        el = converter.replace(doc, css);
        if (!newTreeTop) {
          newTreeTop = el;
        }
        if (newTreeBottom) {
          newTreeBottom.appendChild(el);
        }
        newTreeBottom = el;
        node.style[attr] = '';
      }
    }

    if (newTreeTop) {
      newTreeBottom.appendChild(Noder.empty(node));
      if (node.nodeName === 'SPAN') {
        parent.replaceChild(newTreeTop, node);
      } else {
        node.appendChild(newTreeTop);
      }
    }

    return newTreeBottom || node;
  }

  /*
      Two purposes:

      1. Remove nodes we don't want, such as weird <o:p> tags, comment nodes
         and whitespace nodes.
      2. Convert inline tags into our preferred format.
  */
  cleanTree(node, preserveWS = false) {
    const children = node.childNodes;
    let nonInlineParent, i, l, child, nodeName, nodeType, rewriter, childLength,
      startsWithWS, endsWithWS, data, sibling;

    nonInlineParent = node;
    while (Noder.isInline(nonInlineParent)) {
      nonInlineParent = nonInlineParent.parentNode;
    }
    this.walker.root = nonInlineParent;

    for (i = 0, l = children.length; i < l; i += 1) {
      child = children[i];
      nodeName = child.nodeName;
      nodeType = child.nodeType;
      rewriter = this.stylesRewriters[nodeName];
      if (nodeType === Ambient.ELEMENT_NODE) {
        childLength = child.childNodes.length;
        if (rewriter) {
          child = rewriter(child, node);
        } else if (this.blacklist.test(nodeName)) {
          node.removeChild(child);
          i -= 1;
          l -= 1;
          continue;
        } else if (!this.allowedBlock.test(nodeName) && !Noder.isInline(child)) {
          i -= 1;
          l += childLength - 1;
          node.replaceChild(Noder.empty(child), child);
          continue;
        }
        if (childLength) {
          this.cleanTree(child, preserveWS || (nodeName === 'PRE'));
        }
      } else {
        if (nodeType === Ambient.TEXT_NODE) {
          data = child.data;
          startsWithWS = !Ambient.notWS.test(data.charAt(0));
          endsWithWS = !Ambient.notWS.test(data.charAt(data.length - 1));
          if (preserveWS || (!startsWithWS && !endsWithWS)) {
            continue;
          }
          // Iterate through the nodes; if we hit some other content
          // before the start of a new block we don't trim
          if (startsWithWS) {
            this.walker.currentNode = child;
            while (sibling = this.walker.previousPONode()) {
              nodeName = sibling.nodeName;
              if (nodeName === 'IMG' ||
                (nodeName === '#text' &&
                  Ambient.notWS.test(sibling.data))) {
                break;
              }
              if (!Noder.isInline(sibling)) {
                sibling = null;
                break;
              }
            }
            data = data.replace(/^[ \t\r\n]+/g, sibling ? ' ' : '');
          }
          if (endsWithWS) {
            this.walker.currentNode = child;
            while (sibling = this.walker.nextNode()) {
              if (nodeName === 'IMG' ||
                (nodeName === '#text' &&
                  Ambient.notWS.test(sibling.data))) {
                break;
              }
              if (!Noder.isInline(sibling)) {
                sibling = null;
                break;
              }
            }
            data = data.replace(/[ \t\r\n]+$/g, sibling ? ' ' : '');
          }
          if (data) {
            child.data = data;
            continue;
          }
        }
        node.removeChild(child);
        i -= 1;
        l -= 1;
      }
    }
    return node;
  }

  removeEmptyInlines(node) {
    const children = node.childNodes;
    let child,
      l = children.length;
    while (l--) {
      child = children[l];
      if (child.nodeType === Ambient.ELEMENT_NODE && !Noder.isLeaf(child)) {
        this.removeEmptyInlines(child);
        if (Noder.isInline(child) && !child.firstChild) {
          node.removeChild(child);
        }
      } else if (child.nodeType === Ambient.TEXT_NODE && !child.data) {
        node.removeChild(child);
      }
    }
  }

}

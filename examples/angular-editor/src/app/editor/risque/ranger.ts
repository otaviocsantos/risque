import { Ambient } from './ambient';
import { Noder } from './noder';
import { TreeWalker } from './tree-walker';
import { Clean } from './clean';

export class Ranger {

  static contentWalker = new TreeWalker(null,
    Ambient.SHOW_TEXT | Ambient.SHOW_ELEMENT,
    function (node) {
      return node.nodeType === Ambient.TEXT_NODE ?
        Ambient.notWS.test(node.data) :
        node.nodeName === 'IMG';
    }
  );

  static insertNodeInRange(range, node) {
        // Insert at start.
    let startContainer = range.startContainer,
      startOffset = range.startOffset,
      endContainer = range.endContainer,
      endOffset = range.endOffset,
      parent, children, childCount, afterSplit;

    // If part way through a text node, split it.
    if (startContainer.nodeType === Ambient.TEXT_NODE) {
      parent = startContainer.parentNode;
      children = parent.childNodes;
      if (startOffset === startContainer.length) {
        startOffset = Array.prototype.indexOf.call(children, startContainer) + 1;
        if (range.collapsed) {
          endContainer = parent;
          endOffset = startOffset;
        }
      } else {
        if (startOffset) {
          afterSplit = startContainer.splitText(startOffset);
          if (endContainer === startContainer) {
            endOffset -= startOffset;
            endContainer = afterSplit;
          } else if (endContainer === parent) {
            endOffset += 1;
          }
          startContainer = afterSplit;
        }
        startOffset = Array.prototype.indexOf.call(children, startContainer);
      }
      startContainer = parent;
    } else {
      children = startContainer.childNodes;
    }

    childCount = children.length;

    if (startOffset === childCount) {
      startContainer.appendChild(node);
    } else {
      startContainer.insertBefore(node, children[startOffset]);
    }

    if (startContainer === endContainer) {
      endOffset += children.length - childCount;
    }

    range.setStart(startContainer, startOffset);
    range.setEnd(endContainer, endOffset);
  }


  static getNodeBefore(node, offset) {
        let children = node.childNodes;
    while (offset && node.nodeType === Ambient.ELEMENT_NODE) {
      node = children[offset - 1];
      children = node.childNodes;
      offset = children.length;
    }
    return node;
  }

  static getNodeAfter(node, offset) {
        if (node.nodeType === Ambient.ELEMENT_NODE) {
      const children = node.childNodes;
      if (offset < children.length) {
        node = children[offset];
      } else {
        while (node && !node.nextSibling) {
          node = node.parentNode;
        }
        if (node) { node = node.nextSibling; }
      }
    }
    return node;
  }

  static extractContentsOfRange(range, common, root) {
        let startContainer = range.startContainer,
      startOffset = range.startOffset;
      const endContainer = range.endContainer,
      endOffset = range.endOffset;

    if (!common) {
      common = range.commonAncestorContainer;
    }

    if (common.nodeType === Ambient.TEXT_NODE) {
      common = common.parentNode;
    }

    const endNode = Noder.split(endContainer, endOffset, common, root),
      frag = common.ownerDocument.createDocumentFragment();
    let startNode = Noder.split(startContainer, startOffset, common, root),
      next, before, after;

    // End node will be null if at end of child nodes list.
    while (startNode !== endNode) {
      next = startNode.nextSibling;
      frag.appendChild(startNode);
      startNode = next;
    }

    startContainer = common;
    startOffset = endNode ?
      Array.prototype.indexOf.call(common.childNodes, endNode) :
      common.childNodes.length;

    // Merge text nodes if adjacent. IE10 in particular will not focus
    // between two text nodes
    after = common.childNodes[startOffset];
    before = after && after.previousSibling;
    if (before &&
      before.nodeType === Ambient.TEXT_NODE &&
      after.nodeType === Ambient.TEXT_NODE) {
      startContainer = before;
      startOffset = before.length;
      before.appendData(after.data);
      Noder.detach(after);
    }

    range.setStart(startContainer, startOffset);
    range.collapse(true);

    Noder.fixCursor(common, root);

    return frag;
  }

  static deleteContentsOfRange(range, root) {
        const startBlock = Ranger.getStartBlockOfRange(range, root);
    let endBlock = Ranger.getEndBlockOfRange(range, root);
    const needsMerge = (startBlock !== endBlock);
    let frag, child;

    // Move boundaries up as much as possible without exiting block,
    // to reduce need to split.
    Ranger.moveRangeBoundariesDownTree(range);
    Ranger.moveRangeBoundariesUpTree(range, startBlock, endBlock, root);

    // Remove selected range
    frag = Ranger.extractContentsOfRange(range, null, root);

    // Move boundaries back down tree as far as possible.
    Ranger.moveRangeBoundariesDownTree(range);

    // If we split into two different blocks, merge the blocks.
    if (needsMerge) {
      // endBlock will have been split, so need to refetch
      endBlock = Ranger.getEndBlockOfRange(range, root);
      if (startBlock && endBlock && startBlock !== endBlock) {
        Noder.mergeWithBlock(startBlock, endBlock, range, root);
      }
    }

    // Ensure block has necessary children
    if (startBlock) {
      Noder.fixCursor(startBlock, root);
    }

    // Ensure root has a block-level element in it.
    child = root.firstChild;
    if (!child || child.nodeName === 'BR') {
      Noder.fixCursor(root, root);
      range.selectNodeContents(root.firstChild);
    } else {
      range.collapse(true);
    }
    return frag;
  }

  // ---

  // Contents of range will be deleted.
  // After method, range will be around inserted content
  static insertTreeFragmentIntoRange(range, frag, root, cleaner) {
        let node, block, blockContentsAfterSplit, stopPoint, container, offset;
    let replaceBlock, firstBlockInFrag, nodeAfterSplit, nodeBeforeSplit;
    let tempRange;

    // Fixup content: ensure no top-level inline, and add cursor fix elements.
    Noder.fixContainer(frag, root);
    node = frag;
    while ((node = Noder.getNextBlock(node, root))) {
      Noder.fixCursor(node, root);
    }

    // Delete any selected content.
    if (!range.collapsed) {
      Ranger.deleteContentsOfRange(range, root);
    }

    // Move range down into text nodes.
    Ranger.moveRangeBoundariesDownTree(range);
    range.collapse(false); // collapse to end

    // Where will we split up to? First blockquote parent, otherwise root.
    stopPoint = Noder.getNearest(range.endContainer, root, 'BLOCKQUOTE') || root;

    // Merge the contents of the first block in the frag with the focused block.
    // If there are contents in the block after the focus point, collect this
    // up to insert in the last block later. If the block is empty, replace
    // it instead of merging.
    block = Ranger.getStartBlockOfRange(range, root);
    firstBlockInFrag = Noder.getNextBlock(frag, frag);
    replaceBlock = !!block && Noder.isEmptyBlock(block);
    if (block && firstBlockInFrag && !replaceBlock &&
      // Don't merge table cells or PRE elements into block
      !Noder.getNearest(firstBlockInFrag, frag, 'PRE') &&
      !Noder.getNearest(firstBlockInFrag, frag, 'TABLE')) {
      Ranger.moveRangeBoundariesUpTree(range, block, block, root);
      range.collapse(true); // collapse to start
      container = range.endContainer;
      offset = range.endOffset;
      // Remove trailing <br> – we don't want this considered content to be
      // inserted again later
      cleaner.cleanupBRs(block, root, false);
      if (Noder.isInline(container)) {
        // Split up to block parent.
        nodeAfterSplit = Noder.split(
          container, offset, Noder.getPreviousBlock(container, root), root);
        container = nodeAfterSplit.parentNode;
        offset = Array.prototype.indexOf.call(container.childNodes, nodeAfterSplit);
      }
      if ( /*isBlock( container ) && */offset !== Noder.getLength(container)) {
        // Collect any inline contents of the block after the range point
        blockContentsAfterSplit =
          root.ownerDocument.createDocumentFragment();
        while ((node = container.childNodes[offset])) {
          blockContentsAfterSplit.appendChild(node);
        }
      }
      // And merge the first block in.
      Noder.mergeWithBlock(container, firstBlockInFrag, range, root);

      // And where we will insert
      offset = Array.prototype.indexOf.call(container.parentNode.childNodes, container) + 1;
      container = container.parentNode;
      range.setEnd(container, offset);
    }

    // Is there still any content in the fragment?
    if (Noder.getLength(frag)) {
      if (replaceBlock) {
        range.setEndBefore(block);
        range.collapse(false);
        Noder.detach(block);
      }
      Ranger.moveRangeBoundariesUpTree(range, stopPoint, stopPoint, root);
      // Now split after block up to blockquote (if a parent) or root
      nodeAfterSplit = Noder.split(
        range.endContainer, range.endOffset, stopPoint, root);
      nodeBeforeSplit = nodeAfterSplit ?
        nodeAfterSplit.previousSibling :
        stopPoint.lastChild;
      stopPoint.insertBefore(frag, nodeAfterSplit);
      if (nodeAfterSplit) {
        range.setEndBefore(nodeAfterSplit);
      } else {
        range.setEnd(stopPoint, Noder.getLength(stopPoint));
      }
      block = Ranger.getEndBlockOfRange(range, root);

      // Get a reference that won't be invalidated if we merge containers.
      Ranger.moveRangeBoundariesDownTree(range);
      container = range.endContainer;
      offset = range.endOffset;

      // Merge inserted containers with edges of split
      if (nodeAfterSplit && Noder.isContainer(nodeAfterSplit)) {
        Noder.mergeContainers(nodeAfterSplit, root);
      }
      nodeAfterSplit = nodeBeforeSplit && nodeBeforeSplit.nextSibling;
      if (nodeAfterSplit && Noder.isContainer(nodeAfterSplit)) {
        Noder.mergeContainers(nodeAfterSplit, root);
      }
      range.setEnd(container, offset);
    }

    // Insert inline content saved from before.
    if (blockContentsAfterSplit) {
      tempRange = range.cloneRange();
      Noder.mergeWithBlock(block, blockContentsAfterSplit, tempRange, root);
      range.setEnd(tempRange.endContainer, tempRange.endOffset);
    }
    Ranger.moveRangeBoundariesDownTree(range);
  }

  // ---

  static isNodeContainedInRange(range, node, partial) {
        const nodeRange = node.ownerDocument.createRange();

    nodeRange.selectNode(node);

    if (partial) {
      // Node must not finish before range starts or start after range
      // finishes.
      const nodeEndBeforeStart = (range.compareBoundaryPoints(
        Ambient.END_TO_START, nodeRange) > -1),
        nodeStartAfterEnd = (range.compareBoundaryPoints(
          Ambient.START_TO_END, nodeRange) < 1);
      return (!nodeEndBeforeStart && !nodeStartAfterEnd);
    } else {
      // Node must start after range starts and finish before range
      // finishes
      const nodeStartAfterStart = (range.compareBoundaryPoints(
        Ambient.START_TO_START, nodeRange) < 1),
        nodeEndBeforeEnd = (range.compareBoundaryPoints(
          Ambient.END_TO_END, nodeRange) > -1);
      return (nodeStartAfterStart && nodeEndBeforeEnd);
    }
  }

  static moveRangeBoundariesDownTree(range) {
        let startContainer = range.startContainer,
      startOffset = range.startOffset,
      endContainer = range.endContainer,
      endOffset = range.endOffset,
      maySkipBR = true,
      child;

    while (startContainer.nodeType !== Ambient.TEXT_NODE) {
      child = startContainer.childNodes[startOffset];
      if (!child || Noder.isLeaf(child)) {
        break;
      }
      startContainer = child;
      startOffset = 0;
    }
    if (endOffset) {
      while (endContainer.nodeType !== Ambient.TEXT_NODE) {
        child = endContainer.childNodes[endOffset - 1];
        if (!child || Noder.isLeaf(child)) {
          if (maySkipBR && child && child.nodeName === 'BR') {
            endOffset -= 1;
            maySkipBR = false;
            continue;
          }
          break;
        }
        endContainer = child;
        endOffset = Noder.getLength(endContainer);
      }
    } else {
      while (endContainer.nodeType !== Ambient.TEXT_NODE) {
        child = endContainer.firstChild;
        if (!child || Noder.isLeaf(child)) {
          break;
        }
        endContainer = child;
      }
    }

    // If collapsed, this algorithm finds the nearest text node positions
    // *outside* the range rather than inside, but also it flips which is
    // assigned to which.
    if (range.collapsed) {
      range.setStart(endContainer, endOffset);
      range.setEnd(startContainer, startOffset);
    } else {
      range.setStart(startContainer, startOffset);
      range.setEnd(endContainer, endOffset);
    }
  }

  static moveRangeBoundariesUpTree(range, startMax, endMax, root) {
        let startContainer = range.startContainer;
    let startOffset = range.startOffset;
    let endContainer = range.endContainer;
    let endOffset = range.endOffset;
    let maySkipBR = true;
    let parent;

    if (!startMax) {
      startMax = range.commonAncestorContainer;
    }
    if (!endMax) {
      endMax = startMax;
    }

    while (!startOffset &&
      startContainer !== startMax &&
      startContainer !== root) {
      parent = startContainer.parentNode;
      startOffset = Array.prototype.indexOf.call(parent.childNodes, startContainer);
      startContainer = parent;
    }

    while (true) {
      if (maySkipBR &&
        endContainer.nodeType !== Ambient.TEXT_NODE &&
        endContainer.childNodes[endOffset] &&
        endContainer.childNodes[endOffset].nodeName === 'BR') {
        endOffset += 1;
        maySkipBR = false;
      }
      if (endContainer === endMax ||
        endContainer === root ||
        endOffset !== Noder.getLength(endContainer)) {
        break;
      }
      parent = endContainer.parentNode;
      endOffset = Array.prototype.indexOf.call(parent.childNodes, endContainer) + 1;
      endContainer = parent;
    }

    range.setStart(startContainer, startOffset);
    range.setEnd(endContainer, endOffset);
  }

  // Returns the first block at least partially contained by the range,
  // or null if no block is contained by the range.
  static getStartBlockOfRange(range, root) {
        const container = range.startContainer;
    let block;

    // If inline, get the containing block.
    if (Noder.isInline(container)) {
      block = Noder.getPreviousBlock(container, root);
    } else if (container !== root && Noder.isBlock(container)) {
      block = container;
    } else {
      block = Ranger.getNodeBefore(container, range.startOffset);
      block = Noder.getNextBlock(block, root);
    }
    // Check the block actually intersects the range
    return block && Ranger.isNodeContainedInRange(range, block, true) ? block : null;
  }

  // Returns the last block at least partially contained by the range,
  // or null if no block is contained by the range.
  static getEndBlockOfRange(range, root) {
        const container = range.endContainer;
    let block, child;

    // If inline, get the containing block.
    if (Noder.isInline(container)) {
      block = Noder.getPreviousBlock(container, root);
    } else if (container !== root && Noder.isBlock(container)) {
      block = container;
    } else {
      block = Ranger.getNodeAfter(container, range.endOffset);
      if (!block || !Noder.isOrContains(root, block)) {
        block = root;
        while (child = block.lastChild) {
          block = child;
        }
      }
      block = Noder.getPreviousBlock(block, root);
    }
    // Check the block actually intersects the range
    return block && Ranger.isNodeContainedInRange(range, block, true) ? block : null;
  }


  static rangeDoesStartAtBlockBoundary(range, root) {
        const startContainer = range.startContainer;
    const startOffset = range.startOffset;
    let nodeAfterCursor;

    // If in the middle or end of a text node, we're not at the boundary.
    Ranger.contentWalker.root = null;
    if (startContainer.nodeType === Ambient.TEXT_NODE) {
      if (startOffset) {
        return false;
      }
      nodeAfterCursor = startContainer;
    } else {
      nodeAfterCursor = Ranger.getNodeAfter(startContainer, startOffset);
      if (nodeAfterCursor && !Noder.isOrContains(root, nodeAfterCursor)) {
        nodeAfterCursor = null;
      }
      // The cursor was right at the end of the document
      if (!nodeAfterCursor) {
        nodeAfterCursor = Ranger.getNodeBefore(startContainer, startOffset);
        if (nodeAfterCursor.nodeType === Ambient.TEXT_NODE &&
          nodeAfterCursor.length) {
          return false;
        }
      }
    }

    // Otherwise, look for any previous content in the same block.
    Ranger.contentWalker.currentNode = nodeAfterCursor;
    Ranger.contentWalker.root = Ranger.getStartBlockOfRange(range, root);

    return !Ranger.contentWalker.previousNode();
  }

  static rangeDoesEndAtBlockBoundary(range, root) {
        const endContainer = range.endContainer,
      endOffset = range.endOffset;
    let length;

    // If in a text node with content, and not at the end, we're not
    // at the boundary
    Ranger.contentWalker.root = null;
    if (endContainer.nodeType === Ambient.TEXT_NODE) {
      length = endContainer.data.length;
      if (length && endOffset < length) {
        return false;
      }
      Ranger.contentWalker.currentNode = endContainer;
    } else {
      Ranger.contentWalker.currentNode = Ranger.getNodeBefore(endContainer, endOffset);
    }

    // Otherwise, look for any further content in the same block.
    Ranger.contentWalker.root = Ranger.getEndBlockOfRange(range, root);

    return !Ranger.contentWalker.nextNode();
  }

  static expandRangeToBlockBoundaries(range, root) {
        const start = Ranger.getStartBlockOfRange(range, root),
      end = Ranger.getEndBlockOfRange(range, root);
    let parent;

    if (start && end) {
      parent = start.parentNode;
      range.setStart(parent, Array.prototype.indexOf.call(parent.childNodes, start));
      parent = end.parentNode;
      range.setEnd(parent, Array.prototype.indexOf.call(parent.childNodes, end) + 1);
    }
  }
}

export class TreeWalker {


    static readonly typeToBitArray = {
        // ELEMENT_NODE
        1: 1,
        // ATTRIBUTE_NODE
        2: 2,
        // TEXT_NODE
        3: 4,
        // COMMENT_NODE
        8: 128,
        // DOCUMENT_NODE
        9: 256,
        // DOCUMENT_FRAGMENT_NODE
        11: 1024
    };
    root;
    nodeType;
    filter;
    currentNode;

    constructor(root, nodeType, filter) {
        this.root = this.currentNode = root;
        this.nodeType = nodeType;
        this.filter = filter;
    }

    nextNode() {

        let current = this.currentNode,
            node;
        const root = this.root,
            nodeType = this.nodeType,
            filter = this.filter;
        while (true) {
            node = current.firstChild;
            while (!node && current) {
                if (current === root) {
                    break;
                }
                node = current.nextSibling;
                if (!node) { current = current.parentNode; }
            }
            if (!node) {
                return null;
            }
            if ((TreeWalker.typeToBitArray[node.nodeType] & nodeType) &&
                filter(node)) {
                this.currentNode = node;
                return node;
            }
            current = node;
        }
    }

    previousNode() {

        let current = this.currentNode, node;
        const root = this.root,
            nodeType = this.nodeType,
            filter = this.filter;
        while (true) {
            if (current === root) {
                return null;
            }
            node = current.previousSibling;
            if (node) {
                while (current = node.lastChild) {
                    node = current;
                }
            } else {
                node = current.parentNode;
            }
            if (!node) {
                return null;
            }
            if ((TreeWalker.typeToBitArray[node.nodeType] & nodeType) &&
                filter(node)) {
                this.currentNode = node;
                return node;
            }
            current = node;
        }
    }

    // Previous node in post-order.
    previousPONode() {

        let current = this.currentNode,
            node;
        const root = this.root,
            nodeType = this.nodeType,
            filter = this.filter;
        while (true) {
            node = current.lastChild;
            while (!node && current) {
                if (current === root) {
                    break;
                }
                node = current.previousSibling;
                if (!node) { current = current.parentNode; }
            }
            if (!node) {
                return null;
            }
            if ((TreeWalker.typeToBitArray[node.nodeType] & nodeType) &&
                filter(node)) {
                this.currentNode = node;
                return node;
            }
            current = node;
        }
    }


}

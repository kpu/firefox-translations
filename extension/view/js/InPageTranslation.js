
// eslint-disable-next-line no-unused-vars
class InPageTranslation {

    constructor(mediator) {
        this.translationsCounter = 0;
        this.mediator = mediator;
        this.started = false;
        this.loadTagsSet()
        this.viewportNodeMap = new Map();
        this.hiddenNodeMap = new Map();
        this.nonviewportNodeMap = new Map();
        this.multiPartMessages = new Map();
        this.updateMap = new Map();
        this.updateTimeout = null;
        this.UI_UPDATE_INTERVAL = 500;
        this.messagesSent = new Set();
        this.MAX_CHARS_PER_SECOND = 200; // this should reflect how many characters the engine can process in a second
        this.nodesSent = new Set();
    }

    loadTagsSet() {
        // set of element types we want to translate
        this.tagsSet = new Set();
        this.tagsSet.add("div");
        this.tagsSet.add("b");
        this.tagsSet.add("p");
        this.tagsSet.add("span");
        this.tagsSet.add("i");

        /*
        this.tagsSet.add("#text");
        this.tagsSet.add("a");
        this.tagsSet.add("h3");
        this.tagsSet.add("h2");
        this.tagsSet.add("h1");
        this.tagsSet.add("h4");
        this.tagsSet.add("label");
        this.tagsSet.add("body");
        this.tagsSet.add("li");
        this.tagsSet.add("ul");
        this.tagsSet.add("td");
        */
    }

    start() {

        /*
         * start the dom parser, the DOM mutation observer and request the
         * title to be translated
         */
        this.started = true;
        const pageTitle = document.getElementsByTagName("title")[0];
        if (pageTitle) {
            this.queueTranslation(pageTitle);
        }
        this.startTreeWalker(document.body);
        this.startMutationObserver();
    }

    startTreeWalker(root) {
        const acceptNode = node => {
            return this.validateNode(node);
        }

        const nodeIterator = document.createNodeIterator(
            root,
            // eslint-disable-next-line no-bitwise
            NodeFilter.SHOW_ELEMENT,
            acceptNode
        );

        let currentNode;
        // eslint-disable-next-line no-cond-assign
        while (currentNode = nodeIterator.nextNode()) {
            // mark all children nodes as sent to translation
            console.log(' queuetranslation currentnode', currentNode, 'nodehidden:', this.isElementHidden(currentNode), 'nodeinViewPort:', this.isElementInViewport(currentNode), 'nodeType:', currentNode.nodeType, 'tagName:', currentNode.tagName, 'hasInnerHTML:', currentNode.innerHTML);
            this.queueTranslation(currentNode);
        }

        this.dispatchTranslations();
    }

    isElementInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    isElementHidden(element) {
        return element.style.display === "none" || element.style.visibility === "hidden" || element.offsetParent === null;
    }

    isParentTranslating(node){

        /*
         * if the parent of the node is already translating we should reject
         * it since we already sent it to translation
         */

        // if the immediate parent is the body we just allow it
        if (node.parentNode === document.body) {
            return false;
        }

        // let's iterate until we find either the body or if the parent was sent
        let lastNode = node;
        while (lastNode.parentNode !== document.body) {
            console.log("isParentTranslating node", node, " isParentTranslating nodeParent ", lastNode.parentNode);
            if (this.nodesSent.has(lastNode.parentNode)){
                return true;
            }

            lastNode = lastNode.parentNode;
        }

        return false;
    }

    validateNode(node) {
        if (this.tagsSet.has(node.nodeName.toLowerCase()) &&
            node.textContent.trim().length > 0 &&
            !this.isParentTranslating(node)) {
            return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_REJECT;
    }

    queueTranslation(node) {

        /*
         * let's store the node to keep its reference
         * and send it to the translation worker
         */
        this.translationsCounter += 1;

        // let's categorize the elements on their respective hashmaps
        if (this.isElementHidden(node)) {
            // if the element is entirely hidden
            this.hiddenNodeMap.set(this.translationsCounter, node);
        } else if (this.isElementInViewport(node)) {
            // if the element is present in the viewport
            this.viewportNodeMap.set(this.translationsCounter, node);
        } else {
            // if the element is visible but not present in the viewport
            this.nonviewportNodeMap.set(this.translationsCounter, node);
        }
        this.nodesSent.add(node);
    }

    dispatchTranslations() {

        /*
         * todo: make this more elegant
         * we then submit for translation the elements in order of priority
         */
        this.processingNodeMap = "viewportNodeMap";
        this.viewportNodeMap.forEach(this.submitTranslation, this);
        this.processingNodeMap = "nonviewportNodeMap";
        this.nonviewportNodeMap.forEach(this.submitTranslation, this);
        this.processingNodeMap = "hiddenNodeMap";
        this.hiddenNodeMap.forEach(this.submitTranslation, this);
    }

    // eslint-disable-next-line max-lines-per-function
    submitTranslation(node, key) {
        if (this.messagesSent.has(key)) {
            // if we already sent this message, we just skip it
            return;
        }
        if (node.innerHTML.trim().length) {

            /*
             * here we determine if we should split the message due the size
             * of the node's innerhtml
             */
            if (node.innerHTML.length > this.MAX_CHARS_PER_SECOND) {
                // we split the content in many payloads
                let totalRead = 0;
                let payloadMap = new Map();
                let multiPartPosition = 0;
                while (totalRead < node.innerHTML.length) {
                    multiPartPosition += 1;

                    /*
                     * we need to encapsulate this in another funtion that will
                     * extract the text taking into consideration punctuation,
                     * spaces and end of tags and also the upper limit size of msgs
                     */
                    let readFromHtml = node.innerHTML.substr(totalRead, this.MAX_CHARS_PER_SECOND);
                    totalRead += readFromHtml.length;

                    const payload = {
                        text: readFromHtml,
                        type: "inpage",
                        attrId: [
                                    this.processingNodeMap,
                                    key,
                                    multiPartPosition
                        ],
                    };
                    this.notifyMediator("translate", payload);
                    payloadMap.set(multiPartPosition, null);
                }
                this.multiPartMessages.set(key, payloadMap);
                this.messagesSent.add(key);
            } else {

                /*
                 * send the content back to mediator in order to have the translation
                 * requested by it
                 */
                const payload = {
                text: node.innerHTML,
                type: "inpage",
                attrId: [
                            this.processingNodeMap,
                            key,
                            null
                        ],
                };
                this.notifyMediator("translate", payload);
                this.messagesSent.add(key);
            }
        }
    }

    notifyMediator(command, payload) {
        this.mediator.contentScriptsMessageListener(this, { command, payload });
    }

    startMutationObserver() {
        // select the node that will be observed for mutations
        const targetNode = document;

        // options for the observer (which mutations to observe)
        const config = { attributes: true, childList: true, subtree: true };
        // callback function to execute when mutations are observed
        const callback = function(mutationsList) {
            for (const mutation of mutationsList) {
                if (mutation.type === "childList") {
                    console.log("mutation", mutation);
                    mutation.addedNodes.forEach(node => this.startTreeWalker(node));
                }
            }
        }.bind(this);

        // create an observer instance linked to the callback function
        const observer = new MutationObserver(callback);

        // start observing the target node for configured mutations
        observer.observe(targetNode, config);
    }

    mediatorNotification(translationMessage) {

        /*
         * notification received from the mediator with our request.
         * the only possible notification can be a translation response,
         * so let's schedule the update of the original node with its new content
         */
        this.enqueueElement(translationMessage);
    }

    updateElements() {
        const updateElement = (translatedText, node) => {
            console.log("translate from", node.innerHTML, " to ", translatedText);
            node.innerHTML = translatedText;
        }
        this.updateMap.forEach(updateElement);
        this.updateMap.clear();
        this.updateTimeout = null;
    }

    enqueueElement(translationMessage) {
        const [
               hashMapName,
               idCounter,
               multiPartPosition
        ] = translationMessage.attrId;
        let translatedText = translationMessage.translatedParagraph;
        let targetNode = null;

        /*
         * if we have a multipart request that was completed, then we enqueue it
         * to translation. otherwise we just add to the list of multiparts
         * to this key and wait for it to complete.
         */
        if (multiPartPosition) {
            const mapPayloads = this.multiPartMessages.get(idCounter);
            mapPayloads.set(multiPartPosition, translatedText);
            // let's check if the key is complete
            console.log(multiPartPosition, translatedText);
            let multiPartranslation = "";
            for (let i =1; i<= mapPayloads.size; i+=1) {
                if (!mapPayloads.get(i)) return;
                multiPartranslation = multiPartranslation.concat(mapPayloads.get(i));
            }
            translatedText = multiPartranslation;
            console.log("key complete: ", translatedText);
        }
        switch (hashMapName) {
            case "hiddenNodeMap":
                targetNode = this.hiddenNodeMap.get(idCounter);
                this.hiddenNodeMap.delete(idCounter);
                break;
            case "viewportNodeMap":
                targetNode = this.viewportNodeMap.get(idCounter);
                this.viewportNodeMap.delete(idCounter);
                break;
            case "nonviewportNodeMap":
                targetNode = this.nonviewportNodeMap.get(idCounter);
                this.nonviewportNodeMap.delete(idCounter);
                break;
            default:
                break;
        }
        this.messagesSent.delete(idCounter);
        this.updateMap.set(targetNode, translatedText);
        // we finally schedule the UI update
        if (!this.updateTimeout) {
            this.updateTimeout = setTimeout(this.updateElements.bind(this),this.UI_UPDATE_INTERVAL);
        }
    }
}
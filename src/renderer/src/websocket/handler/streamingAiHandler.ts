// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUBLISH, SAI } from "../../constant";
export default class StreamingAiHandler extends AbstractMessageHandler {
    match(proto) {
        return proto.signal === PUBLISH && proto.subSignal === SAI;
    }

    processMessage(proto) {
        const { i: streamId, d: delta, f: isDone, t: target } = JSON.parse(proto.content);
        this.vueWebsocket.sendAction('appendStreamingContent', { streamId, delta, isDone, target });
    }
}

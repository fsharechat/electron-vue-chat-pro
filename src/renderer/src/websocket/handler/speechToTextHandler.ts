// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUB_ACK, ASR } from "../../constant";

/**
 * 语音转文字应答。失败时服务端 content 为空串，AbstractMessageHandler 会直接给 ERROR_CODE，不会走到 notifyContent
 */
export default class SpeechToTextHandler extends AbstractMessageHandler {
    match(proto){
        return proto.signal == PUB_ACK && proto.subSignal == ASR;
    }
    notifyContent(content){
        return JSON.parse(content);
    }
}

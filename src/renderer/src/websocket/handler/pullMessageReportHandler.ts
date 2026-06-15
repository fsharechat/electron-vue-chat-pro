// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUB_ACK, MRP } from "../../constant";
import MessageReport from "../model/messageReport";

export default class PullMessageReportHandler extends AbstractMessageHandler{

    match(proto){
        return proto.signal == PUB_ACK && proto.subSignal == MRP;
    }

    processMessage(proto){
        var content = JSON.parse(proto.content);
        console.log("current "+content.current+" head "+content.head+" messageCount "+content.messageCount);
        for(var protoMessageReport of content.messageReportList){
           var messageReport = MessageReport.toMessageReport(protoMessageReport)
           this.vueWebsocket.sendAction('addMessageReport',messageReport);
        }
    }
}
// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUB_ACK, MRR } from "../../constant";

export default class ReadReportHandler extends AbstractMessageHandler{
    match(proto){
        return proto.signal == PUB_ACK && proto.subSignal == MRR;
    }
}
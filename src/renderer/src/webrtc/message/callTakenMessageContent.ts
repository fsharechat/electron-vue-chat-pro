// @ts-nocheck
import MessageContent from '../../websocket/message/messageContent';
import MessageContentType from '../../websocket/message/messageContentType';
import StringUtils from "../../websocket/utils/StringUtil"

/**
 * 406 多端同步信令：告知自己账号的其他设备「这通电话我处理了」。
 * 只投递给发送者自己的其他设备，对端永远收不到。
 */
export default class CallTakenMessageContent extends MessageContent {
  static REASON_ANSWERED = 'answered';
  static REASON_REJECTED = 'rejected';

  callId;
  reason;
  deviceId;

  constructor() {
    super(MessageContentType.VOIP_CONTENT_TYPE_MULTI_CLIENT_SYNC);
  }

  digest() {
    return '';
  }

  encode() {
    let payload = super.encode();
    payload.content = this.callId;
    payload.binaryContent = StringUtils.utf8_to_b64(JSON.stringify({
      r: this.reason,
      d: this.deviceId || ''
    }));
    return payload;
  }

  decode(payload) {
    super.decode(payload);
    this.callId = payload.content;
    // r 缺失/不认识一律回退 answered —— 406 只在接听与拒接时发送，两者都要求
    // 本端关闭来电界面，默认 answered 保证核心行为不因 payload 异常失效。
    this.reason = CallTakenMessageContent.REASON_ANSWERED;
    this.deviceId = '';
    if (!payload.binaryContent) {
      return;
    }
    try {
      let obj = JSON.parse(StringUtils.b64_to_utf8(payload.binaryContent));
      if (obj.r === CallTakenMessageContent.REASON_REJECTED) {
        this.reason = CallTakenMessageContent.REASON_REJECTED;
      }
      this.deviceId = obj.d || '';
    } catch (e) {
      console.log('decode callTaken payload error', e);
    }
  }
}

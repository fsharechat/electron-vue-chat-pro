// @ts-nocheck
class MessageShardingUtil {
    static rotateId = 0;
    static nodeId = 0;

    static rotateIdWidth = 15;
    static rotateIdMask = 0x7FFF;

    static nodeIdWidth = 6;
    static nodeIdMask = 0x3F;

    static T201801010000 = 1514736000000;

    // 模拟简单的锁，JS单线程一般不需要
    static _lock = false;

    static setNodeId(nodeId) {
        MessageShardingUtil.nodeId = nodeId;
    }

    /**
     * ID = timestamp(43) + nodeId(6) + rotateId(15)
     * 时间限制到2157/5/15（2的42次幂代表的时间 + (2018-1970)）。
     * 节点数限制小于64，每台服务器每毫秒最多发送32768条消息
     * @return {number} 生成的唯一ID
     */
    static generateId() {
        // 简单的同步锁模拟
        this.rotateId = (this.rotateId + 1) & this.rotateIdMask;

        let id = BigInt(Date.now() - this.T201801010000);

        id = id << BigInt(this.nodeIdWidth);
        id = id + BigInt(this.nodeId & this.nodeIdMask);

        id = id << BigInt(this.rotateIdWidth);
        id = id + BigInt(this.rotateId);
        console.log("generateId id "+id);
        return id.toString();
    }
}

export default MessageShardingUtil;

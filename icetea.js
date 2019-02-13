const createABCIServer = require('abci')
  , msgpack = require('msgpack5')();

const Worker = require('./blockchain/Worker');
const Tx = require('./blockchain/Tx');

const worker = new Worker();

// turn on debug logging
require('debug').enable('abci*')

let handlers = {
  info(req) {
    return {
      data: 'icetea',
      version: '0.0.1',
      appVerion: '0.0.1',
      lastBlockHeight: worker.blocks.length?worker.blocks[worker.blocks.length - 1].number:0,
      lastBlockAppHash: Buffer.alloc(0)
    }
  },

  checkTx(req) {

    let reqTx = decodeBytes(req.tx);
    console.log("checkTx", reqTx);

    const tx = new Tx(
      reqTx.from, 
      reqTx.to, 
      parseFloat(reqTx.value) || 0, 
      parseFloat(reqTx.fee) || 0,
      JSON.parse(reqTx.data || "{}"),
      reqTx.nonce);
    tx.setSignature(reqTx.signature);

    try {
      worker.checkTx(tx);
      return { code: 0, data: Buffer.from(tx.tHash, "hex"), log: 'tx succeeded' }
    } catch (err) {
      return { code: 1, log: String(err) }
    }
  },

  beginBlock(req) {
    const hash = req.hash.toString("hex");
    const number = req.header.height.toNumber();
    const timestamp = req.header.time.seconds.toNumber();
    worker.beginBlock({number, hash, timestamp, txs: []});
    return {}; // tags
  },

  async deliverTx(req) {
    let reqTx = decodeBytes(req.tx);
    //console.log("deliverTx", reqTx);

    const tx = new Tx(
      reqTx.from, 
      reqTx.to, 
      parseFloat(reqTx.value) || 0, 
      parseFloat(reqTx.fee) || 0,
      JSON.parse(reqTx.data || "{}"),
      reqTx.nonce);
    tx.setSignature(reqTx.signature);

    try {
      worker.verifyTx(tx);
      await worker.execTx(tx);
      return { code: 0, data: Buffer.from(tx.tHash, "hex"), log: 'tx succeeded' }
    } catch (err) {
      return { code: 1, log: String(err) }
    }
  },

  endBlock(...args) {
    console.log("endBlock", ...args);
    return {};
  },

  commit(...args) {
    console.log("commit", ...args);
    return {data: Buffer.alloc(0)}
  },

  query(req) {
    //console.log(req.path, req.data.toString(), req.prove || false);

    const prove = !!req.prove;
    const path = req.path;
    const data = req.data.toString();

    switch (path) {
      case "balance":
        return replyQuery({
          balance: worker.balanceOf(data)
        })
      case "node":
        return replyQuery(worker);
      case "tx":
        return replyQuery(worker.getReceipt(data));
      case "txs":
        return replyQuery(worker.getReceipts());
      case "blocks":
        return replyQuery(worker.getBlocks());
      case "contracts":
        return replyQuery(worker.getContractAddresses());
      case "funcs": {
        let arr = [];
        if (data) {
            arr = worker.getFuncNames(data);
        } 
        return replyQuery(arr);
      }
      case "call": {
        try {
          const options = msgpack.decode(Buffer.from(data, "hex"));
          const result = replyQuery(worker.callViewFunc(options.address, options.name, options.params));
          return replyQuery({
            success: true,
            data: result
          })
        } catch (error) {
          console.log(error)
          return replyQuery({
            success: false,
            data: error
          })
        }
      }
    }

    return {code: 1, info: "Path not supported"}
  },
}

// make sure the transaction data is 4 bytes long
function decodeBytes(bytes) {
  return msgpack.decode(bytes);
}

function replyQuery(data) {
  return {code: 0, info: JSON.stringify(data)};
}

let port = 26658
createABCIServer(handlers).listen(port, () => {
  console.log(`listening on port ${port}`)
})
import {
  rpc,
  utils,
  verifyLoginMessage,
  createToken,
  verifyToken,
  ClaimStatus,
  Unclaimed,
  Claimed,
  Disabled,
  ClaimHistory,
} from '@sudt-faucet/commons';
import { Request } from 'express';
import { DB } from '../db';
import { InsertMailIssue, ServerContext, ClaimRecord } from '../types';
import { genKeyPair } from '../util/createKey';

const keyPair = genKeyPair();

export class IssuerRpcHandler implements rpc.IssuerRpc {
  constructor(private context: ServerContext) {}

  async login(payload: rpc.LoginPayload): Promise<rpc.LoginResponse> {
    if (!process.env.USER_ADDRESS) throw new Error('USER_ADDRESS not set');
    const address = process.env.USER_ADDRESS;
    const { message, sig } = payload;
    const result = await verifyLoginMessage(sig, message, address);
    if (result) {
      const token = createToken(address, keyPair.privateKey);
      return { jwt: token };
    }
    throw new Error('Only the owner is allowed to access');
  }

  verify_user(req: Request): void {
    const token = req.get('authorization') || '';
    verifyToken(token, keyPair.publicKey);
  }

  list_issued_sudt(_payload: rpc.GetIssuedHistoryPayload): Promise<rpc.GetIssuedHistoryResponse> {
    utils.unimplemented();
  }

  send_claimable_mails(payload: rpc.SendClaimableMailsPayload): Promise<void> {
    if (payload.recipients.length === 0) throw new Error('call send_claimable_mails with empty payload');
    const recordsWithSecret: InsertMailIssue[] = payload.recipients.map((recipient) => {
      if (recipient.additionalMessage.length >= 2048)
        throw new Error('error: additional message character length should not exceed 2048');
      return {
        mail_address: recipient.mail,
        sudt_issuer_pubkey_hash: payload.rcIdentity.pubkeyHash,
        sudt_issuer_rc_id_flag: Number(payload.rcIdentity.flag),
        sudt_id: recipient.sudtId,
        amount: recipient.amount,
        secret: utils.randomHexString(32).slice(2),
        mail_message: recipient.additionalMessage,
        expire_time: recipient.expiredAt,
        status: 'WaitForSendMail',
      };
    });
    return DB.getInstance().batchInsertMailIssue(recordsWithSecret);
  }

  get_claimable_sudt_balance(
    _payload: rpc.GetClaimableSudtBalancePayload,
  ): Promise<rpc.GetClaimableSudtBalanceResponse> {
    utils.unimplemented();
  }

  async list_claim_history(payload: rpc.ListClaimHistoryPayload): Promise<rpc.ListClaimHistoryResponse> {
    const records = await DB.getInstance().getClaimHistoryBySudtId(payload.sudtId);
    const claimHistories = records.map(convertRecordToResponse);
    return { histories: claimHistories };
  }

  async get_claim_history(payload: rpc.GetClaimHistoryPayload): Promise<rpc.GetClaimHistoryResponse> {
    const record = await DB.getInstance().getClaimHistoryBySecret(payload.secret);
    return { history: record ? convertRecordToResponse(record) : undefined };
  }

  get_claimable_account_address(): Promise<string> {
    return this.context.txSigner.getAddress();
  }

  // TODO resolve concurrency with claim sudt
  async disable_claim_secret(payload: rpc.DisableClaimSecretPayload): Promise<void> {
    const db = DB.getInstance();
    const status = await db.getStatusBySecret(payload.claimSecret);
    if (!status) throw new Error('error: secret not found');
    if (status === 'Disabled') throw new Error('error: already disabled');
    if (status !== 'WaitForSendMail' && status !== 'WaitForClaim')
      throw new Error('error: can not disable secret after user claimed');
    return db.updateStatusBySecrets([payload.claimSecret], 'Disabled');
  }

  async claim_sudt(payload: rpc.ClaimSudtPayload): Promise<void> {
    if (payload.address.length >= 255) throw new Error('error: mail address character length should not exceed 255');
    const db = DB.getInstance();
    const status = await db.getStatusBySecret(payload.claimSecret);
    if (!status) throw new Error('The claim is invalid. Please make sure you have a valid claim invitation');
    if (status !== 'WaitForClaim') throw new Error('It seems you have already claimed');
    return db.claimBySecret(payload.claimSecret, payload.address, 'WaitForTransfer');
  }
}

function convertRecordToResponse(record: ClaimRecord): ClaimHistory {
  const claimStatus: ClaimStatus = (() => {
    switch (record.status) {
      case 'WaitForSendMail':
      case 'WaitForClaim':
        return { status: 'unclaimed' } as Unclaimed;
      case 'WaitForTransfer':
      case 'SendingTransaction':
      case 'WaitForTransactionCommit':
      case 'WaitForTransactionConfirm':
      case 'Done':
      case 'TransferSudtError':
      case 'SendMailError': {
        return {
          status: 'claimed',
          claimedStartAt: 0,
          txHash: 'undo',
          claimedAt: 0,
          address: record.claim_address,
        } as Claimed;
      }
      case 'Disabled': {
        return {
          status: 'disabled',
        } as Disabled;
      }
      default:
        throw new Error('exception: unknown record status');
    }
  })();
  return {
    mail: record.mail_address,
    createdAt: Number(record.created_at) * 1000,
    expiredAt: record.expire_time,
    amount: record.amount,
    claimSecret: record.secret,
    claimStatus,
  };
}

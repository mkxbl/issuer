import { CkitInitOptions, predefined } from '@ckitjs/ckit';
import { env } from '@sudt-faucet/commons';

interface GlobalConfig {
  ckitConfig: CkitInitOptions;
  mercuryUrl: string;
  ckbRpcUrl: string;
  unipassUrl: string;
  walletUrl: string;
  nervosExploreTxUrlPrefix: string;
}

function getConfig(): GlobalConfig {
  const ckitConfig = env.readAsStr('REACT_APP_NETWORK', 'Aggron') === 'Lina' ? predefined.Lina : predefined.Aggron;
  const NERVOS_EXPLORER_URL = env.readAsStr('NERVOS_EXPLORER_URL', 'https://explorer.nervos.org/aggron');

  return {
    ckitConfig,
    ckbRpcUrl: env.readAsStr('REACT_APP_CKB_NODE_URL', 'https://testnet.ckb.dev/rpc'),
    mercuryUrl: env.readAsStr('REACT_APP_CKB_INDEXER_URL', 'https://testnet.ckb.dev/indexer'),
    unipassUrl: env.readAsStr('REACT_APP_UNIPASS_URL', 'https://t.unipass.xyz'),
    walletUrl: env.readAsStr('REACT_APP_WALLET_URL', 'https://t.tok.social'),
    nervosExploreTxUrlPrefix: `${NERVOS_EXPLORER_URL}/transaction`,
  };
}

const DEFAULT_CONFIG = getConfig();

export function useGlobalConfig(): GlobalConfig {
  return DEFAULT_CONFIG;
}

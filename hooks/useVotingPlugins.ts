import { useEffect } from 'react'
import useWalletStore from 'stores/useWalletStore'
import useRealm from '@hooks/useRealm'
import { getNfts } from '@utils/tokens'
import { Metadata } from '@metaplex-foundation/mpl-token-metadata'
import { Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js'
import useNftPluginStore from 'NftVotePlugin/store/nftPluginStore'
import useSwitchboardPluginStore from 'SwitchboardVotePlugin/store/switchboardStore'
import { QUEUE_LIST } from 'SwitchboardVotePlugin/SwitchboardQueueVoterClient'
import useVotePluginsClientStore from 'stores/useVotePluginsClientStore'
import {
  getMaxVoterWeightRecord,
  getVoterWeightRecord,
  getGovernanceAccount,
  GovernanceAccountType,
  Governance
} from '@solana/spl-governance'
import { getNftMaxVoterWeightRecord } from 'NftVotePlugin/sdk/accounts'
import { notify } from '@utils/notifications'
import { AccountLayout, NATIVE_MINT } from '@solana/spl-token'
import * as anchor from '@project-serum/anchor'
import * as sbv2 from '../../switchboardv2-api'
//import sbidl from '../../switchboard-core/switchboard_v2/target/idl/switchboard_v2.json'
import sbidl from '../../reclone-sbc/switchboard_v2/target/idl/switchboard_v2.json';
import gonidl from '../../reclone-sbc/switchboard_v2/target/idl/gameofnodes.json';

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  Token,
} from '@solana/spl-token'
import {
  LOCALNET_STAKING_ADDRESS as PYTH_LOCALNET_STAKING_ADDRESS,
  DEVNET_STAKING_ADDRESS as PYTH_DEVNET_STAKING_ADDRESS,
} from 'pyth-staking-api'

export const vsrPluginsPks: string[] = [
  '4Q6WW2ouZ6V3iaNm56MTd5n2tnTm4C5fiH8miFHnAFHo',
]

export const nftPluginsPks: string[] = [
  'GnftV5kLjd67tvHpNGyodwWveEKivz3ZWvvE3Z4xi2iw',
]

export const switchboardPluginsPks: string[] = [
  /*'HFdD2QauAai5W6n36xkt9MUcsNRn1L2WYEMvi5WbnyVJ',
  '7PMP6yE6qb3XzBQr5TK2GhuruYayZzBnT8U92ySaLESC',*/
  'B4EDDdMh5CmB6B9DeMmZmFvRzEgyHR5zWktf6httcMk6'
]

export const pythPluginsPks: string[] = [
  PYTH_LOCALNET_STAKING_ADDRESS.toBase58(),
  PYTH_DEVNET_STAKING_ADDRESS.toBase58(),
]

export function useVotingPlugins() {
  const { realm, config, ownTokenRecord } = useRealm()
  const {
    handleSetVsrRegistrar,
    handleSetVsrClient,
    handleSetNftClient,
    handleSetSwitchboardClient,
    handleSetNftRegistrar,
    handleSetPythClient,
    handleSetCurrentRealmVotingClient,
  } = useVotePluginsClientStore()
  const {
    setVotingNfts,
    setMaxVoterWeight,
    setIsLoadingNfts,
  } = useNftPluginStore()
  const { setIsLoading, setVotingPower, setOracleKeys, setInstructions } = useSwitchboardPluginStore()

  const wallet = useWalletStore((s) => s.current)
  const connection = useWalletStore((s) => s.connection)
  const connected = useWalletStore((s) => s.connected)
  const vsrClient = useVotePluginsClientStore((s) => s.state.vsrClient)
  const nftClient = useVotePluginsClientStore((s) => s.state.nftClient)
  const switchboardClient = useVotePluginsClientStore(
    (s) => s.state.switchboardClient
  )
  const pythClient = useVotePluginsClientStore((s) => s.state.pythClient)
  const currentClient = useVotePluginsClientStore(
    (s) => s.state.currentRealmVotingClient
  )
  const currentPluginPk = config?.account.communityVoterWeightAddin
  const nftMintRegistrar = useVotePluginsClientStore(
    (s) => s.state.nftMintRegistrar
  )
  const usedCollectionsPks: string[] =
    (currentPluginPk &&
      nftPluginsPks.includes(currentPluginPk?.toBase58()) &&
      nftMintRegistrar?.collectionConfigs.map((x) =>
        x.collection.toBase58()
      )) ||
    []
  const handleGetNfts = async () => {
    setIsLoadingNfts(true)
    try {
      const nfts = await getNfts(connection.current, wallet!.publicKey!)
      const votingNfts = (
        await Promise.all(
          nfts.map((x) => getIsFromCollection(x.mint, x.tokenAddress))
        )
      ).filter((x) => x) as { metadata: Metadata; tokenAddress: PublicKey }[]
      const nftsWithMeta = votingNfts.map((x) => {
        const nft = nfts.find(
          (nft) => nft.tokenAddress === x.tokenAddress.toBase58()
        )
        return {
          ...nft!,
          metadata: x.metadata,
        }
      })
      setVotingNfts(nftsWithMeta, currentClient, nftMintRegistrar)
    } catch (e) {
      console.log(e)
      notify({
        message: "Something went wrong can't fetch nfts",
        type: 'error',
      })
    }
    setIsLoadingNfts(false)
  }
  const handleGetSwitchboardVoting = async () => {
    if (!wallet || !wallet.publicKey || !realm) {
      return
    }

    setIsLoading(true)

    try {
      const options = anchor.AnchorProvider.defaultOptions()
      const provider = new anchor.AnchorProvider(
        connection.current,
        (wallet as unknown) as anchor.Wallet,
        options
      )

      let idl = await anchor.Program.fetchIdl(sbv2.SBV2_MAINNET_PID, provider)
      if (!idl) {
        console.log("Off chain idl");
        idl = sbidl as anchor.Idl
      }
      console.log("IDL");
      console.log(idl);

      let addinIdl = await anchor.Program.fetchIdl(new PublicKey("B4EDDdMh5CmB6B9DeMmZmFvRzEgyHR5zWktf6httcMk6"), provider)
      if (!addinIdl) {
        console.log("Off chain addin idl");
        addinIdl = gonidl as anchor.Idl
      }

      const switchboardProgram = new anchor.Program(
        idl,
        //sbv2.SBV2_MAINNET_PID,
        new PublicKey("7PMP6yE6qb3XzBQr5TK2GhuruYayZzBnT8U92ySaLESC"),
        provider
      )

      const addinProgram = new anchor.Program(
        addinIdl,
        new PublicKey("B4EDDdMh5CmB6B9DeMmZmFvRzEgyHR5zWktf6httcMk6"),
        provider
      )

      const allOracles = await switchboardProgram.account.oracleAccountData.all();
      const oracleData = allOracles.map(({publicKey, account}) => {
        return {
          oracleData: account,
          oracle: publicKey,
        }
      });
      
      let myNodesForRealm: PublicKey[] = [];
      let setVoterWeightInstructions: TransactionInstruction[] = [];

      for (const { oracle, oracleData } of oracleData) {
        if (!wallet || !wallet.publicKey || !realm || !oracleData) {
          continue
        }
        let queuePk = oracleData.queuePubkey;

        let [addinState, _] = await PublicKey.findProgramAddress(
          [
            Buffer.from('state'),
          ],
          addinProgram.programId,
        );

        let addinStateData = await addinProgram.account.state.fetch(addinState);
        let queue = await switchboardProgram.account.oracleQueueAccountData.fetch(queuePk);
        let queueAuthority = queue.authority;
        let grantAuthority = addinStateData.grantAuthority;
        try {
          let g = await getGovernanceAccount(provider.connection, grantAuthority, Governance);
          if (
            g.account.realm.equals(realm.pubkey) &&
            oracleData.oracleAuthority.equals(wallet.publicKey)
          ) {
            myNodesForRealm.push(oracle);
            let [p] = sbv2.PermissionAccount.fromSeed(
              switchboardProgram,
              queueAuthority,
              queuePk,
              oracle
            );
            let ix = await p.setVoterWeightTx({govProgram: realm.owner, pubkeySigner: wallet.publicKey}, addinProgram, grantAuthority);
            setVoterWeightInstructions.push(
              ix.instructions[0]
            );
          }
        }
        catch (e) {
          console.log(e);
          console.log("the authority isn't a governance");
        }
      }

      setOracleKeys(myNodesForRealm, currentClient);
      setInstructions(setVoterWeightInstructions, currentClient);
      console.log(myNodesForRealm);

      try {
        const [
          voterWeightRecord,
        ] = anchor.utils.publicKey.findProgramAddressSync(
          [Buffer.from('VoterWeightRecord'), myNodesForRealm[0].toBytes()],
          //sbv2.SBV2_MAINNET_PID
          //new PublicKey("7PMP6yE6qb3XzBQr5TK2GhuruYayZzBnT8U92ySaLESC")
          new PublicKey("B4EDDdMh5CmB6B9DeMmZmFvRzEgyHR5zWktf6httcMk6"),
        )

        const vw = await connection.current.getAccountInfo(voterWeightRecord)

        const vwr = await getVoterWeightRecord(
          connection.current,
          voterWeightRecord
        )
        console.log(vwr)
        if (vwr && vwr.account.realm.equals(realm.pubkey)) {
          console.log(vwr.account.voterWeight.toNumber())
          // get voting power
          console.log("SWITCHBOARD VOTER WEIGHT FOUND AND SET");
          setVotingPower(vwr.account.voterWeight)
        } else {
          // 'no sb governance'
          setVotingPower(new anchor.BN(0))
          console.log("NO VOTER WEIGHT");
        }
      }
      catch(e) {
        console.log("Couldn't get VWR");
        console.log(e);
      }

    } catch (e) {
      console.log(e)
      notify({
        message: "Something went wrong can't fetch switchboard voting power",
        type: 'error',
      })
    }
    setIsLoading(false)
  }

  const handleMaxVoterWeight = async () => {
    const { maxVoterWeightRecord } = await getNftMaxVoterWeightRecord(
      realm!.pubkey,
      realm!.account.communityMint,
      nftClient!.program.programId
    )
    try {
      const existingMaxVoterRecord = await getMaxVoterWeightRecord(
        connection.current,
        maxVoterWeightRecord
      )
      setMaxVoterWeight(existingMaxVoterRecord)
    } catch (e) {
      console.log(e)
      setMaxVoterWeight(null)
    }
  }
  const getIsFromCollection = async (mint: string, tokenAddress: string) => {
    const metadataAccount = await Metadata.getPDA(mint)
    const metadata = await Metadata.load(connection.current, metadataAccount)
    return (
      !!(
        metadata.data.collection?.key &&
        usedCollectionsPks.includes(metadata.data.collection?.key) &&
        metadata.data.collection.verified
      ) && {
        tokenAddress: new PublicKey(tokenAddress),
        metadata: metadata as Metadata,
      }
    )
  }
  useEffect(() => {
    handleSetVsrClient(wallet, connection)
    handleSetNftClient(wallet, connection)
    handleSetSwitchboardClient(wallet, connection)
    handleSetPythClient(wallet, connection)
  }, [connection.endpoint])

  useEffect(() => {
    const handleVsrPlugin = () => {
      if (
        vsrClient &&
        currentPluginPk &&
        vsrPluginsPks.includes(currentPluginPk.toBase58())
      ) {
        handleSetVsrRegistrar(vsrClient, realm)
        if (connected) {
          handleSetCurrentRealmVotingClient({
            client: vsrClient,
            realm,
            walletPk:
              ownTokenRecord?.account?.governingTokenOwner || wallet?.publicKey,
          })
        }
      }
    }
    const handleNftplugin = () => {
      if (
        nftClient &&
        currentPluginPk &&
        nftPluginsPks.includes(currentPluginPk.toBase58())
      ) {
        handleSetNftRegistrar(nftClient!, realm)
        if (connected) {
          handleSetCurrentRealmVotingClient({
            client: nftClient,
            realm,
            walletPk:
              ownTokenRecord?.account?.governingTokenOwner || wallet?.publicKey,
          })
        }
      }
    }

    const handlePythPlugin = () => {
      if (
        pythClient &&
        currentPluginPk &&
        pythPluginsPks.includes(currentPluginPk.toBase58())
      ) {
        if (connected) {
          handleSetCurrentRealmVotingClient({
            client: pythClient,
            realm,
            walletPk:
              ownTokenRecord?.account?.governingTokenOwner || wallet?.publicKey,
          })
        }
      }
    }
    const handleSwitchboardPlugin = () => {
      if (
        switchboardClient &&
        currentPluginPk &&
        switchboardPluginsPks.includes(currentPluginPk.toBase58())
      ) {
        // Switchboard: don't think we need this
        //handleSetNftRegistrar(nftClient!, realm)
        console.log('Switchboard')
        if (connected) {
          handleSetCurrentRealmVotingClient({
            client: switchboardClient,
            realm,
            walletPk: wallet?.publicKey,
          })
        }
      }
    }
    if (
      !currentClient ||
      currentClient.realm?.pubkey.toBase58() !== realm?.pubkey.toBase58() ||
      currentClient.walletPk?.toBase58() !== wallet?.publicKey?.toBase58()
    ) {
      handleNftplugin()
      handleVsrPlugin()
      handleSwitchboardPlugin()
      handlePythPlugin()
    }
  }, [
    currentPluginPk?.toBase58(),
    vsrClient?.program.programId.toBase58(),
    nftClient?.program.programId.toBase58(),
    pythClient?.program.programId.toBase58(),
    realm?.pubkey.toBase58(),
    connection.endpoint,
    connected,
    ownTokenRecord,
  ])

  useEffect(() => {
    handleGetSwitchboardVoting()
    if (usedCollectionsPks.length && realm) {
      if (connected && currentClient.walletPk?.toBase58()) {
        handleGetNfts()
      }
      handleMaxVoterWeight()
    } else if (realm) {
      handleGetSwitchboardVoting()
    } else {
      setVotingNfts([], currentClient, nftMintRegistrar)
      setMaxVoterWeight(null)
    }
  }, [
    JSON.stringify(usedCollectionsPks),
    currentPluginPk?.toBase58(),
    connected,
    realm?.pubkey.toBase58(),
    currentClient.walletPk?.toBase58(),
  ])
}

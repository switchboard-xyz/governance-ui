import { useEffect } from 'react'
import useWalletStore from 'stores/useWalletStore'
import useRealm from '@hooks/useRealm'
import { getNfts } from '@utils/tokens'
import { Metadata } from '@metaplex-foundation/mpl-token-metadata'
import { Keypair, PublicKey } from '@solana/web3.js'
import useNftPluginStore from 'NftVotePlugin/store/nftPluginStore'
import useSwitchboardPluginStore from 'SwitchboardVotePlugin/store/switchboardStore'
import { QUEUE_LIST } from 'SwitchboardVotePlugin/SwitchboardQueueVoterClient'
import useVotePluginsClientStore from 'stores/useVotePluginsClientStore'
import {
  getMaxVoterWeightRecord,
  getVoterWeightRecord,
} from '@solana/spl-governance'
import { getNftMaxVoterWeightRecord } from 'NftVotePlugin/sdk/accounts'
import { notify } from '@utils/notifications'
import { AccountLayout, NATIVE_MINT } from '@solana/spl-token'
import * as anchor from '@project-serum/anchor'
import * as sbv2 from '../../switchboardv2-api'
import sbidl from '../../switchboard-core/switchboard_v2/target/idl/switchboard_v2.json'

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  Token,
} from '@solana/spl-token'

export const vsrPluginsPks: string[] = [
  '4Q6WW2ouZ6V3iaNm56MTd5n2tnTm4C5fiH8miFHnAFHo',
]

export const nftPluginsPks: string[] = [
  'GnftV5kLjd67tvHpNGyodwWveEKivz3ZWvvE3Z4xi2iw',
]

export const switchboardPluginsPks: string[] = [
  'HFdD2QauAai5W6n36xkt9MUcsNRn1L2WYEMvi5WbnyVJ',
]

export function useVotingPlugins() {
  const { realm, config } = useRealm()
  const {
    handleSetVsrRegistrar,
    handleSetVsrClient,
    handleSetNftClient,
    handleSetSwitchboardClient,
    handleSetNftRegistrar,
    handleSetCurrentRealmVotingClient,
  } = useVotePluginsClientStore()
  const {
    setVotingNfts,
    setMaxVoterWeight,
    setIsLoadingNfts,
  } = useNftPluginStore()
  const { setIsLoading, setVotingPower } = useSwitchboardPluginStore()

  const wallet = useWalletStore((s) => s.current)
  const connection = useWalletStore((s) => s.connection)
  const connected = useWalletStore((s) => s.connected)
  const vsrClient = useVotePluginsClientStore((s) => s.state.vsrClient)
  const nftClient = useVotePluginsClientStore((s) => s.state.nftClient)
  const switchboardClient = useVotePluginsClientStore(
    (s) => s.state.switchboardClient
  )
  const currentClient = useVotePluginsClientStore(
    (s) => s.state.currentRealmVotingClient
  )
  const currentPluginPk = config?.account.communityVoterWeightAddin
  const nftMintRegistrar = useVotePluginsClientStore(
    (s) => s.state.nftMintRegistrar
  )
  const usedCollectionsPks: string[] =
    nftMintRegistrar?.collectionConfigs.map((x) => x.collection.toBase58()) ||
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
        idl = sbidl as anchor.Idl
      }
      const switchboardProgram = new anchor.Program(
        idl,
        sbv2.SBV2_MAINNET_PID,
        provider
      )

      const allQueues = await switchboardProgram.account.oracleQueueAccountData.all()

      const queueListData = allQueues.map(({ publicKey, account }) => {
        return {
          queueData: account,
          queue: publicKey,
        }
      })

      // go through queues, get governance addresses until current realm + governance combo exists
      for (const { queue, queueData } of queueListData) {
        if (!wallet || !wallet.publicKey || !realm || !queueData) {
          continue
        }

        const switchTokenMint = new Token(
          switchboardProgram.provider.connection,
          (queueData.mint as PublicKey).equals(PublicKey.default)
            ? NATIVE_MINT
            : (queueData.mint as PublicKey),
          TOKEN_PROGRAM_ID,
          Keypair.generate()
        )

        // get token wallet for this user associated with this queue's mint
        const tokenWallet = await Token.getAssociatedTokenAddress(
          switchTokenMint.associatedProgramId,
          switchTokenMint.programId,
          switchTokenMint.publicKey,
          wallet.publicKey
        )

        // get the oracle account associated with wallet
        const [oracle] = anchor.utils.publicKey.findProgramAddressSync(
          [
            Buffer.from('OracleAccountData'),
            queue.toBuffer(),
            tokenWallet.toBuffer(),
          ],
          sbv2.SBV2_MAINNET_PID
        )

        // get VWR from the oracle
        const [
          voterWeightRecord,
        ] = anchor.utils.publicKey.findProgramAddressSync(
          [Buffer.from('VoterWeightRecord'), oracle.toBytes()],
          sbv2.SBV2_MAINNET_PID
        )

        console.log(voterWeightRecord)

        const vw = await connection.current.getAccountInfo(voterWeightRecord)
        console.log(vw)

        const vwr = await getVoterWeightRecord(
          connection.current,
          voterWeightRecord
        )
        console.log(vwr)

        // does current realm / governance resolve (at all), does VWR exist
        if (vwr && vwr.account.realm.equals(realm.pubkey)) {
          console.log(vwr.account.voterWeight.toNumber())
          // get voting power
          setVotingPower(vwr.account.voterWeight)
        } else {
          // 'no sb governance'
          setVotingPower(new anchor.BN(0))
        }
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
            walletPk: wallet?.publicKey,
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
            walletPk: wallet?.publicKey,
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
    }
  }, [
    currentPluginPk?.toBase58(),
    vsrClient?.program.programId.toBase58(),
    nftClient?.program.programId.toBase58(),
    realm?.pubkey.toBase58(),
    connection.endpoint,
    connected,
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

const { network, ethers } = require('hardhat')
const { developmentChains, networkConfig } = require('../helper-hardhat-config')
const { verify } = require('../utils/verify')

const VRF_SUB_FUND_AMOUNT = ethers.utils.parseEther('30')

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy, log } = deployments
  const { deployer } = await getNamedAccounts()
  // Pointing to networkConfig in helper file
  const chainId = network.config.chainId
  let vrfCoordinatorV2Address
  let subscriptionId

  if (developmentChains.includes(network.name)) {
    const vrfCoordinatorV2Mock = await ethers.getContract('VRFCoordinatorV2Mock')
    vrfCoordinatorV2Address = vrfCoordinatorV2Mock.address
    const transactionReponse = await vrfCoordinatorV2Mock.createSubscription()
    const transactionReceipt = await transactionReponse.wait(1)
    subscriptionId = transactionReceipt.events[0].args.subId
    // Fund subscription; usually you'd need the LINK token on the real network
    await vrfCoordinatorV2Mock.fundSubscription(subscriptionId, VRF_SUB_FUND_AMOUNT)
  } else {
    vrfCoordinatorV2Address = networkConfig[chainId]['vrfCoordinatorV2']
    subscriptionId = networkConfig[chainId]['subscriptionId']
  }

  const entranceFee = networkConfig[chainId]['entranceFee']
  const gasLane = networkConfig[chainId]['gasLane']
  const callbackGasLimit = networkConfig[chainId]['callbackGasLimit']
  const interval = networkConfig[chainId]['interval']
  const args = [
    vrfCoordinatorV2Address,
    entranceFee,
    gasLane,
    subscriptionId,
    callbackGasLimit,
    interval
  ]
  const raffle = await deploy('Raffle', {
    from: deployer,
    args: args,
    log: true,
    waitConfirmations: network.config.blockConfirmations || 1
  })

  // Addition to allow consumer for upKeep
  if (developmentChains.includes(network.name)) {
    const vrfCoordinatorV2Mock = await ethers.getContract('VRFCoordinatorV2Mock')
    await vrfCoordinatorV2Mock.addConsumer(subscriptionId.toNumber(), raffle.address)
    log('adding consumer...')
    log('Consumer added!')
  }

  if (!developmentChains.includes(network.name) && process.env.ETHERSCAN_API_KEY) {
    log('Verfying...')
    await verify(raffle.address, args)
  }
  log('---------------------------------------------')
}

module.exports.tags = ['all', 'raffle']

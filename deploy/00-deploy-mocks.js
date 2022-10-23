const { network } = require('hardhat')
const { developmentChains } = require('../helper-hardhat-config')

// VRFCoordinatorV2Mock constructor
// 0.25 is the premium... consts .25 LINK for a request
const BASE_FEE = ethers.utils.parseEther('0.25')
// Calculated value based on the gas price of the chain
const GAS_PRICE_LINK = 1e9

module.exports = async ({ getNamedAccounts, deployments }) => {
  const { deploy, log } = deployments
  const { deployer } = await getNamedAccounts()
  const args = [BASE_FEE, GAS_PRICE_LINK]

  if (developmentChains.includes(network.name)) {
    log('Local network detected! Deploying mocks...')

    await deploy('VRFCoordinatorV2Mock', {
      from: deployer,
      log: true,
      // Constructor args
      args: args,
    })
    log('Mocks Deployed!')
    log('-------------------------------------------------')
  }
}

module.exports.tags = ['all', 'mocks']

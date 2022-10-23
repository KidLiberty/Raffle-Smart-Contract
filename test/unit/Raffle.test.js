// Only run our unit tests on a development chain
const { getNamedAccounts, ethers, deployments, network } = require('hardhat')
const { assert, expect } = require('chai')
const { developmentChains, networkConfig } = require('../../helper-hardhat-config')

!developmentChains.includes(network.name)
  ? describe.skip
  : describe('Raffle unit tests', () => {
      let deployer
      let raffle
      let vrfCoordinatorV2Mock
      let raffleEntranceFee
      let interval
      const chainId = network.config.chainId

      beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer
        await deployments.fixture(['all'])
        raffle = await ethers.getContract('Raffle', deployer)
        vrfCoordinatorV2Mock = await ethers.getContract('VRFCoordinatorV2Mock', deployer)
        raffleEntranceFee = await raffle.getEntranceFee()
        interval = await raffle.getInterval()
      })

      describe('constructor', async () => {
        it('Initializes the raffle correctly', async () => {
          const raffleState = await raffle.getRaffleState()
          assert.equal(raffleState.toString(), '0')
          assert.equal(interval.toString(), networkConfig[chainId]['interval'])
        })
      })

      describe('enterRaffle', async () => {
        it("Reverts when you don't pay enough", async () => {
          await expect(raffle.enterRaffle()).to.be.revertedWith('Raffle__NotEnoughETHEntered')
        })
        it('Records players when they enter', async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          const playerFromContract = await raffle.getPlayer(0)
          assert.equal(playerFromContract, deployer)
        })
        it('Emits event on enter', async () => {
          await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
            raffle,
            'RaffleEnter'
          )
        })
        it("Doesn't allow entrance when Raffle is calculating", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send('evm_increaseTime', [interval.toNumber() + 1])
          await network.provider.send('evm_mine', [])
          await raffle.performUpkeep([])
          await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
            'Raffle__RaffleNotOpen'
          )
        })
      })
    })

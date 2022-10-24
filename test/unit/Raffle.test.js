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

      describe('constructor', () => {
        it('Initializes the raffle correctly', async () => {
          const raffleState = await raffle.getRaffleState()
          assert.equal(raffleState.toString(), '0')
          assert.equal(interval.toString(), networkConfig[chainId]['interval'])
        })
      })

      describe('enterRaffle', () => {
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
          await network.provider.send('evm_increaseTime', [Number(interval) + 1])
          await network.provider.send('evm_mine', [])
          await raffle.performUpkeep([])
          await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
            'Raffle__RaffleNotOpen'
          )
        })
      })

      describe('checkUpkeep', () => {
        it("Returns false if people haven't sent any ETH", async () => {
          await network.provider.send('evm_increaseTime', [Number(interval) + 1])
          await network.provider.send('evm_mine', [])
          // Simulate calling this TRX and seeing what it will response with
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
          assert(!upkeepNeeded)
        })
        it("Returns false if Raffle isn't open", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send('evm_increaseTime', [Number(interval) + 1])
          await network.provider.send('evm_mine', [])
          // [] or 0x HardHat knows this is a blank 'bytes' object
          await raffle.performUpkeep([])
          const raffleState = await raffle.getRaffleState()
          const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
          assert.equal(raffleState.toString(), 1)
          assert.equal(upkeepNeeded, false)
        })
        it("Returns false if enough time hasn't passed", async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send('evm_increaseTime', [Number(interval) - 1])
          await network.provider.send('evm_mine', [])
          const { upkeedNeeded } = await raffle.callStatic.checkUpkeep([])
          assert(!upkeedNeeded)
        })
        it('Returns true if enough time has passed, has players, ETH, and is open', async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send('evm_increaseTime', [Number(interval) + 1])
          await network.provider.send('evm_mine', [])
          const { upkeedNeeded } = await raffle.callStatic.checkUpkeep([])
          assert(!upkeedNeeded)
        })
      })

      describe('performUpkeep', () => {
        it('Can only run if checkUpkeep is true', async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send('evm_increaseTime', [Number(interval) + 1])
          await network.provider.send('evm_mine', [])
          const transaction = await raffle.performUpkeep([])
          assert(transaction)
        })
        it('Reverts when chuckUpkeep is false', async () => {
          await expect(raffle.performUpkeep([])).to.be.revertedWith('Raffle__UpkeepNotNeeded')
        })
        it('Udates the Raffle state, emits an event, and call the VRFCoordinator', async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send('evm_increaseTime', [Number(interval) + 1])
          await network.provider.send('evm_mine', [])
          const transactionResponse = await raffle.performUpkeep([])
          const transactionReceipt = await transactionResponse.wait(1)
          const requestId = transactionReceipt.events[1].args.requestId
          const raffleState = await raffle.getRaffleState()
          assert(Number(requestId) > 0)
          assert(raffleState.toString() == '1')
        })
      })

      describe('fulfillRandomWords', () => {
        // Have someone enter the raffle before you run these tests
        beforeEach(async () => {
          await raffle.enterRaffle({ value: raffleEntranceFee })
          await network.provider.send('evm_increaseTime', [Number(interval) - 1])
          await network.provider.send('evm_mine', [])
        })

        it('Can only be called after performUpkeep', async () => {
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
          ).to.be.revertedWith('nonexistent request')
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
          ).to.be.revertedWith('nonexistent request')
        })

        it('Picks a winner, resets the lottery, and sends the money', async () => {
          const additionalEntrants = 3
          const startingAccountIndex = 1 // deployer = 0
          const accounts = await ethers.getSigners()
          for (i = startingAccountIndex; i < startingAccountIndex + additionalEntrants; i++) {
            const accountConnectedRaffle = raffle.connect(accounts[i])
            await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee })
          }
          const startingTimeStamp = await raffle.getLatestTimeStamp()

          await new Promise(async (resolve, reject) => {
            raffle.once('WinnerPicked', async () => {
              console.log('Found the event!')
              try {
                const recentWinner = await raffle.getRecentWinner()
                console.log(recentWinner)
                console.log(accounts[0].address)
                console.log(accounts[1].address)
                console.log(accounts[2].address)
                console.log(accounts[3].address)
                const raffleState = await raffle.getRaffleState()
                const endingTimestamp = await raffle.getLatestTimeStamp()
                const numPlayers = await raffle.getNumberOfPlayers()
                const winnerEndingBalance = await accounts[1].getBalance()
                assert.equal(numPlayers.toString(), '0')
                assert.equal(raffleState.toString(), '0')
                assert(endingTimestamp > startingTimeStamp)

                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance.add(
                    raffleEntranceFee.mul(additionalEntrants).add(raffleEntranceFee.toString())
                  )
                )
              } catch (e) {
                reject(e)
              }
              resolve()
            })
            const transaction = await raffle.performUpkeep([])
            const transactionReceipt = await transaction.wait(1)
            const winnerStartingBalance = await accounts[1].getBalance()
            await vrfCoordinatorV2Mock.fulfillRandomWords(
              transactionReceipt.events[1].args.requestId,
              raffle.address
            )
          })
        })
      })
    })

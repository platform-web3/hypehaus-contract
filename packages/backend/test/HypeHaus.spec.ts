import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { BigNumber, ContractTransaction } from 'ethers';
import { ethers } from 'hardhat';
import { MerkleTree } from 'merkletreejs';

import { HypeHaus } from '../typechain-types/HypeHaus';
import {
  HypeHausAccessControlErrorCode,
  HypeHausErrorCode,
  HypeHausSale,
} from '../shared';

type MerkleTreeLeaf = ReturnType<typeof keccak256>;
type MerkleTreeProof = ReturnType<MerkleTree['getHexProof']>;

const MAX_SUPPLY = 10;
const MASKED_BASE_TOKEN_URI = 'protocol://mask1234/';
const REVEALED_BASE_TOKEN_URI = 'protocol://abcd1234/';

const keccak256 = ethers.utils.keccak256;

function getHexProof(tree: MerkleTree, address: string): MerkleTreeProof {
  return tree.getHexProof(keccak256(address));
}

describe('HypeHaus Contract', () => {
  let hypeHaus: HypeHaus;

  type SignerName = 'deployer' | 'team' | 'u1' | 'u2' | 'u3' | 'u4' | 'u5';
  let signers: Record<SignerName, SignerWithAddress>;
  let addresses: Record<SignerName, SignerWithAddress['address']>;

  let MAX_MINT_ALPHA: number;
  let MAX_MINT_HYPELISTER: number;
  let MAX_MINT_HYPEMEMBER: number;
  let MAX_MINT_PUBLIC: number;
  let COMMUNITY_SALE_PRICE: BigNumber;
  let PUBLIC_SALE_PRICE: BigNumber;

  beforeEach(async () => {
    const [deployer, team, u1, u2, u3, u4, u5] = await ethers.getSigners();
    signers = { deployer, team, u1, u2, u3, u4, u5 };
    addresses = {
      deployer: deployer.address,
      team: team.address,
      u1: u1.address,
      u2: u2.address,
      u3: u3.address,
      u4: u4.address,
      u5: u5.address,
    };

    const factory = await ethers.getContractFactory('HypeHaus', deployer);

    hypeHaus = (await factory.deploy(
      MAX_SUPPLY,
      MASKED_BASE_TOKEN_URI,
      team.address,
    )) as HypeHaus;
    await hypeHaus.deployed();

    MAX_MINT_ALPHA = await hypeHaus.maxMintAlpha();
    MAX_MINT_HYPELISTER = await hypeHaus.maxMintHypelister();
    MAX_MINT_HYPEMEMBER = await hypeHaus.maxMintHypemember();
    MAX_MINT_PUBLIC = await hypeHaus.maxMintPublic();
    COMMUNITY_SALE_PRICE = await hypeHaus.communitySalePrice();
    PUBLIC_SALE_PRICE = await hypeHaus.publicSalePrice();
  });

  describe('Initialization', () => {
    it('reports correct maximum supply', async () => {
      expect(await hypeHaus.maxSupply()).to.eq(MAX_SUPPLY);
    });

    it('reports correct total of minted HYPEHAUSes', async () => {
      expect(await hypeHaus.totalMinted()).to.eq(0);
    });

    it('starts off with Inactive sale state', async () => {
      expect(await hypeHaus.activeSale()).to.eq(HypeHausSale.Closed);
    });
  });

  describe('Prerequisites', () => {
    describe('Active Sale', () => {
      it('can change current active sale', async () => {
        expect(await hypeHaus.activeSale()).to.eq(HypeHausSale.Closed);
        await hypeHaus.setActiveSale(HypeHausSale.Community);
        expect(await hypeHaus.activeSale()).to.eq(HypeHausSale.Community);
        await hypeHaus.setActiveSale(HypeHausSale.Public);
        expect(await hypeHaus.activeSale()).to.eq(HypeHausSale.Public);
        // Test that calling only-owner function as non-owner fails (we don't care
        // about the error message so we pass an empty string).
        await expect(
          hypeHaus.connect(signers.u1).setActiveSale(HypeHausSale.Closed),
        ).to.be.revertedWith('');
      });

      it('fails to mint when community sale is not active', async () => {
        const leaves = [addresses.u1].map(keccak256);
        const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const root = tree.getHexRoot();
        const proof = tree.getHexProof(leaves[0]);

        // Set the same root for all tiers for testing purposes
        await hypeHaus.setAlphaMerkleRoot(root);
        await hypeHaus.setHypelisterMerkleRoot(root);
        await hypeHaus.setHypememberMerkleRoot(root);

        const expectFailedCommunityMints = async () => {
          await expect(hypeHaus.mintAlpha(1, proof)).to.be.revertedWith(
            HypeHausErrorCode.CommunitySaleNotActive,
          );
          await expect(hypeHaus.mintHypelister(1, proof)).to.be.revertedWith(
            HypeHausErrorCode.CommunitySaleNotActive,
          );
          await expect(hypeHaus.mintHypemember(1, proof)).to.be.revertedWith(
            HypeHausErrorCode.CommunitySaleNotActive,
          );
        };

        await hypeHaus.setActiveSale(HypeHausSale.Closed);
        await expectFailedCommunityMints();

        await hypeHaus.setActiveSale(HypeHausSale.Public);
        await expectFailedCommunityMints();
      });

      it('fails to mint when public sale is not active', async () => {
        await hypeHaus.setActiveSale(HypeHausSale.Closed);
        await expect(hypeHaus.mintPublic(1)).to.be.revertedWith(
          HypeHausErrorCode.PublicSaleNotActive,
        );

        await hypeHaus.setActiveSale(HypeHausSale.Community);
        await expect(hypeHaus.mintPublic(1)).to.be.revertedWith(
          HypeHausErrorCode.PublicSaleNotActive,
        );
      });
    });

    describe('Sufficient Supply', () => {
      function getAlmostMax(mintAmount: number) {
        return MAX_SUPPLY % mintAmount === 0
          ? Math.floor((MAX_SUPPLY - 1) / mintAmount)
          : Math.floor(MAX_SUPPLY / mintAmount);
      }

      it('fails to mint when supply has run out', async () => {
        const [_d, _t, ...restSigners] = await ethers.getSigners();
        const leaves = restSigners.map((s) => keccak256(s.address));
        const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const root = tree.getHexRoot();

        await hypeHaus.setActiveSale(HypeHausSale.Community);
        await hypeHaus.setAlphaMerkleRoot(root);
        await hypeHaus.setHypelisterMerkleRoot(root);
        await hypeHaus.setHypememberMerkleRoot(root);

        const almostMaxAlpha = getAlmostMax(MAX_MINT_ALPHA);
        await Promise.all(
          [...Array(getAlmostMax(almostMaxAlpha))].map(async (_, i) => {
            await expect(
              hypeHaus
                .connect(restSigners[i])
                .mintAlpha(MAX_MINT_ALPHA, tree.getHexProof(leaves[i]), {
                  value: COMMUNITY_SALE_PRICE.mul(MAX_MINT_ALPHA),
                }),
            ).to.not.be.revertedWith(HypeHausErrorCode.SupplyExhausted);
          }),
        );

        await hypeHaus.setActiveSale(HypeHausSale.Community);
        await expect(
          hypeHaus
            .connect(restSigners[almostMaxAlpha])
            .mintHypelister(2, tree.getHexProof(leaves[almostMaxAlpha]), {
              value: COMMUNITY_SALE_PRICE,
            }),
        ).to.be.revertedWith(HypeHausErrorCode.SupplyExhausted);
      });
    });

    describe('Valid Mint Amount', () => {
      let tree: MerkleTree;
      let leaves: MerkleTreeLeaf[];
      let proofs: MerkleTreeProof[];
      let signers: SignerWithAddress[];

      async function expectFailedCommunityMint(
        signer: SignerWithAddress,
        proof: MerkleTreeProof,
        maxMintAmount: number,
        mintFn: (
          contract: HypeHaus,
          amount: number,
          proof: MerkleTreeProof,
        ) => Promise<any>,
      ) {
        await expect(
          mintFn(hypeHaus.connect(signer), 0, proof),
        ).to.be.revertedWith(HypeHausErrorCode.InvalidMintAmount);
        await expect(
          mintFn(hypeHaus.connect(signer), maxMintAmount + 1, proof),
        ).to.be.revertedWith(HypeHausErrorCode.InvalidMintAmount);
      }

      beforeEach(async () => {
        signers = await ethers.getSigners().then((signers) => signers.slice(2));
        leaves = signers.slice(0, -1).map((s) => keccak256(s.address));
        tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        proofs = leaves.map((l) => tree.getHexProof(l));

        await hypeHaus.setActiveSale(HypeHausSale.Community);
        await hypeHaus.setAlphaMerkleRoot(tree.getHexRoot());
        await hypeHaus.setHypelisterMerkleRoot(tree.getHexRoot());
        await hypeHaus.setHypememberMerkleRoot(tree.getHexRoot());
      });

      it('fails to mint invalid amount as Alpha', async () => {
        await expectFailedCommunityMint(
          signers[0],
          proofs[0],
          MAX_MINT_ALPHA,
          (hypeHaus, amount, proof) => hypeHaus.mintAlpha(amount, proof),
        );
      });

      it('fails to mint invalid amount as Hypelister', async () => {
        await expectFailedCommunityMint(
          signers[0],
          proofs[0],
          MAX_MINT_HYPELISTER,
          (hypeHaus, amount, proof) => hypeHaus.mintHypelister(amount, proof),
        );
      });

      it('fails to mint invalid amount as Hypemember', async () => {
        await expectFailedCommunityMint(
          signers[0],
          proofs[0],
          MAX_MINT_HYPELISTER,
          (hypeHaus, amount, proof) => hypeHaus.mintHypemember(amount, proof),
        );
      });

      it('fails to mint invalid amount as public member', async () => {
        await hypeHaus.setActiveSale(HypeHausSale.Public);
        await expect(hypeHaus.mintPublic(0)).to.be.revertedWith(
          HypeHausErrorCode.InvalidMintAmount,
        );
        await expect(
          hypeHaus.mintPublic(MAX_MINT_PUBLIC + 1),
        ).to.be.revertedWith(HypeHausErrorCode.InvalidMintAmount);
      });
    });

    describe('Sufficient Funds', () => {
      let tree: MerkleTree;
      let leaves: MerkleTreeLeaf[];
      let proofs: MerkleTreeProof[];
      let signers: SignerWithAddress[];

      beforeEach(async () => {
        signers = await ethers.getSigners().then((signers) => signers.slice(2));
        leaves = signers.slice(0, -1).map((s) => keccak256(s.address));
        tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        proofs = leaves.map((l) => tree.getHexProof(l));
        await hypeHaus.setActiveSale(HypeHausSale.Community);
        await hypeHaus.setAlphaMerkleRoot(tree.getHexRoot());
        await hypeHaus.setHypelisterMerkleRoot(tree.getHexRoot());
        await hypeHaus.setHypememberMerkleRoot(tree.getHexRoot());
      });

      it('fails to mint with insufficient funds as Alpha', async () => {
        for (let amount = 1, i = 0; amount < MAX_MINT_ALPHA; amount++, i++) {
          await expect(
            hypeHaus.connect(signers[i]).mintAlpha(amount, proofs[i]),
          ).to.be.revertedWith(HypeHausErrorCode.InsufficientFunds);
        }
      });

      it('fails to mint with insufficient funds as Hypelister', async () => {
        for (
          let amount = 1, i = 0;
          amount < MAX_MINT_HYPELISTER;
          amount++, i++
        ) {
          await expect(
            hypeHaus.connect(signers[i]).mintHypelister(amount, proofs[i]),
          ).to.be.revertedWith(HypeHausErrorCode.InsufficientFunds);
        }
      });

      it('fails to mint with insufficient funds as Hypemember', async () => {
        for (
          let amount = 1, i = 0;
          amount < MAX_MINT_HYPELISTER;
          amount++, i++
        ) {
          await expect(
            hypeHaus.connect(signers[i]).mintHypemember(amount, proofs[i]),
          ).to.be.revertedWith(HypeHausErrorCode.InsufficientFunds);
        }
      });

      it('fails to mint with insufficient funds as public member', async () => {
        await hypeHaus.setActiveSale(HypeHausSale.Public);
        await expect(
          hypeHaus.connect(signers[0]).mintPublic(1),
        ).to.be.revertedWith(HypeHausErrorCode.InsufficientFunds);

        await expect(
          hypeHaus.connect(signers[0]).mintPublic(MAX_MINT_PUBLIC),
        ).to.be.revertedWith(HypeHausErrorCode.InsufficientFunds);
      });
    });

    describe('Unique Claim', () => {
      it('fails to mint when signer has already minted in community sale', async () => {
        const cohort = [signers.u1, signers.u2, signers.u3];
        const leaves = cohort.map((signer) => keccak256(signer.address));
        const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
        const root = tree.getHexRoot();
        const getProof = (index: number) => tree.getHexProof(leaves[index]);

        await hypeHaus.setActiveSale(HypeHausSale.Community);
        await hypeHaus.setAlphaMerkleRoot(root);
        await hypeHaus.setHypelisterMerkleRoot(root);
        await hypeHaus.setHypememberMerkleRoot(root);

        await expect(
          hypeHaus
            .connect(signers.u1)
            .mintAlpha(1, getProof(0), { value: COMMUNITY_SALE_PRICE }),
        ).to.not.be.revertedWith('');

        await expect(
          hypeHaus
            .connect(signers.u2)
            .mintHypelister(1, getProof(1), { value: COMMUNITY_SALE_PRICE }),
        ).to.not.be.revertedWith('');

        await expect(
          hypeHaus
            .connect(signers.u3)
            .mintHypemember(1, getProof(2), { value: COMMUNITY_SALE_PRICE }),
        ).to.not.be.revertedWith('');

        await Promise.all(
          cohort.map(async (signer, index) => {
            await expect(
              hypeHaus
                .connect(signer)
                .mintAlpha(1, getProof(index), { value: COMMUNITY_SALE_PRICE }),
            ).to.be.revertedWith(HypeHausErrorCode.AlreadyClaimed);
            await expect(
              hypeHaus.connect(signer).mintHypelister(1, getProof(index), {
                value: COMMUNITY_SALE_PRICE,
              }),
            ).to.be.revertedWith(HypeHausErrorCode.AlreadyClaimed);
            await expect(
              hypeHaus.connect(signer).mintHypemember(1, getProof(index), {
                value: COMMUNITY_SALE_PRICE,
              }),
            ).to.be.revertedWith(HypeHausErrorCode.AlreadyClaimed);
          }),
        );
      });

      it('fails to mint when signer has already minted maximum in public sale', async () => {
        await hypeHaus.setActiveSale(HypeHausSale.Public);

        await expect(
          hypeHaus
            .connect(signers.u1)
            .mintPublic(1, { value: PUBLIC_SALE_PRICE }),
        ).to.not.be.revertedWith('');

        await expect(
          hypeHaus
            .connect(signers.u2)
            .mintPublic(2, { value: PUBLIC_SALE_PRICE.mul(2) }),
        ).to.not.be.revertedWith('');

        // Should be able to mint 1 and no more after
        await expect(
          hypeHaus
            .connect(signers.u1)
            .mintPublic(1, { value: PUBLIC_SALE_PRICE }),
        ).to.not.be.revertedWith(HypeHausErrorCode.AlreadyClaimed);

        // Should NOT be able to mint anymore
        await expect(
          hypeHaus
            .connect(signers.u2)
            .mintPublic(1, { value: PUBLIC_SALE_PRICE }),
        ).to.be.revertedWith(HypeHausErrorCode.AlreadyClaimed);

        // Should be able to mint 1 more after
        await expect(
          hypeHaus
            .connect(signers.u3)
            .mintPublic(1, { value: PUBLIC_SALE_PRICE }),
        ).to.not.be.revertedWith(HypeHausErrorCode.AlreadyClaimed);
      });
    });

    describe('Verification', () => {
      type Tier = {
        tree: MerkleTree;
        leaves: MerkleTreeLeaf[];
        verifiedSigners: SignerWithAddress[];
      };

      let alphaTier: Tier;
      let hypelisterTier: Tier;
      let hypememberTier: Tier;
      let unverifiedSigners: SignerWithAddress[];

      beforeEach(async () => {
        const allSigners = await ethers.getSigners().then((s) => s.slice(2));
        const [a1, a2, hl1, hl2, hm1, hm2, ...restSigners] = allSigners;
        unverifiedSigners = restSigners;

        const aSigners = [a1, a2];
        const hlSigners = [hl1, hl2];
        const hmSigners = [hm1, hm2];

        const aLeaves = aSigners.map((s) => keccak256(s.address));
        const hlLeaves = hlSigners.map((s) => keccak256(s.address));
        const hmLeaves = hmSigners.map((s) => keccak256(s.address));

        const aTree = new MerkleTree(aLeaves, keccak256, { sortPairs: true });
        const hlTree = new MerkleTree(hlLeaves, keccak256, { sortPairs: true });
        const hmTree = new MerkleTree(hmLeaves, keccak256, { sortPairs: true });

        alphaTier = {
          tree: aTree,
          leaves: aLeaves,
          verifiedSigners: aSigners,
        };

        hypelisterTier = {
          tree: hlTree,
          leaves: hlLeaves,
          verifiedSigners: hlSigners,
        };

        hypememberTier = {
          tree: hmTree,
          leaves: hmLeaves,
          verifiedSigners: hmSigners,
        };

        await hypeHaus.setActiveSale(HypeHausSale.Community);
        await hypeHaus.setAlphaMerkleRoot(aTree.getHexRoot());
        await hypeHaus.setHypelisterMerkleRoot(hlTree.getHexRoot());
        await hypeHaus.setHypememberMerkleRoot(hmTree.getHexRoot());
      });

      it('fails to mint when signer cannot be proved to be Alpha', async () => {
        for (const signer of alphaTier.verifiedSigners) {
          const claimedProof = getHexProof(alphaTier.tree, signer.address);
          expect(
            hypeHaus.connect(signer).mintAlpha(1, claimedProof, {
              value: COMMUNITY_SALE_PRICE,
            }),
          ).to.not.be.revertedWith(HypeHausErrorCode.VerificationFailure);
        }

        const claimer = unverifiedSigners[0];
        const claimedProof = getHexProof(alphaTier.tree, claimer.address);
        expect(
          hypeHaus.connect(claimer).mintAlpha(1, claimedProof, {
            value: COMMUNITY_SALE_PRICE,
          }),
        ).to.be.revertedWith(HypeHausErrorCode.VerificationFailure);
      });

      it('fails to mint when signer cannot be proved to be Hypelister', async () => {
        for (const signer of hypelisterTier.verifiedSigners) {
          const claimedProof = getHexProof(hypelisterTier.tree, signer.address);
          expect(
            hypeHaus.connect(signer).mintHypelister(1, claimedProof, {
              value: COMMUNITY_SALE_PRICE,
            }),
          ).to.not.be.revertedWith(HypeHausErrorCode.VerificationFailure);
        }

        const claimer = unverifiedSigners[0];
        const claimedProof = getHexProof(hypelisterTier.tree, claimer.address);
        expect(
          hypeHaus.connect(claimer).mintHypelister(1, claimedProof, {
            value: COMMUNITY_SALE_PRICE,
          }),
        ).to.be.revertedWith(HypeHausErrorCode.VerificationFailure);
      });

      it('fails to mint when signer cannot be proved to be Hypemember', async () => {
        for (const signer of hypememberTier.verifiedSigners) {
          const claimedProof = getHexProof(hypememberTier.tree, signer.address);
          expect(
            hypeHaus.connect(signer).mintHypemember(1, claimedProof, {
              value: COMMUNITY_SALE_PRICE,
            }),
          ).to.not.be.revertedWith(HypeHausErrorCode.VerificationFailure);
        }

        const claimer = unverifiedSigners[0];
        const claimedProof = getHexProof(hypememberTier.tree, claimer.address);
        expect(
          hypeHaus.connect(claimer).mintHypemember(1, claimedProof, {
            value: COMMUNITY_SALE_PRICE,
          }),
        ).to.be.revertedWith(HypeHausErrorCode.VerificationFailure);
      });
    });
  });

  describe('Minting', () => {
    let tree: MerkleTree;
    let leaves: MerkleTreeLeaf[];
    let signers: SignerWithAddress[];

    beforeEach(async () => {
      signers = await ethers.getSigners().then((signers) => signers.slice(2));
      leaves = signers.slice(0, -1).map((s) => keccak256(s.address));
      tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
      expect(await hypeHaus.totalMinted()).to.eq(0);
    });

    async function expectSuccessfulCommunityMint(
      index: number,
      maxMintAmount: number,
      mintFn: (
        contract: HypeHaus,
        amount: number,
        proof: MerkleTreeProof,
        overrides: any,
      ) => Promise<ContractTransaction>,
    ) {
      const signer = signers[index];
      const proof = getHexProof(tree, signer.address);
      const previousTotal = await hypeHaus.totalMinted();

      const overrides = { value: COMMUNITY_SALE_PRICE.mul(maxMintAmount) };
      await expect(
        mintFn(hypeHaus.connect(signer), maxMintAmount, proof, overrides),
      ).to.emit(hypeHaus, 'Transfer');

      const currentTotal = await hypeHaus.totalMinted();
      const expectedTotal = previousTotal.add(maxMintAmount);
      expect(currentTotal).to.eq(expectedTotal);
    }

    describe('Airdrop', () => {
      it('mints and gifts new HYPEHAUSes to some address', async () => {
        await hypeHaus.mintUnchecked(addresses.u1, 1);
        expect(await hypeHaus.ownerOf(0)).to.eq(addresses.u1);

        await hypeHaus.mintUnchecked(addresses.u2, MAX_MINT_ALPHA + 1);
        expect(await hypeHaus.ownerOf(1)).to.eq(addresses.u2);
        expect(await hypeHaus.ownerOf(2)).to.eq(addresses.u2);
        expect(await hypeHaus.ownerOf(3)).to.eq(addresses.u2);
        expect(await hypeHaus.ownerOf(4)).to.eq(addresses.u2);

        await hypeHaus.mintUnchecked(addresses.deployer, 1);
        expect(await hypeHaus.ownerOf(5)).to.eq(addresses.deployer);
      });

      it('transfers a token to some address', async () => {
        await hypeHaus.mintUnchecked(addresses.deployer, 5);

        await hypeHaus.transferFrom(addresses.deployer, addresses.u1, 0);
        await hypeHaus.transferFrom(addresses.deployer, addresses.u1, 1);
        await hypeHaus.transferFrom(addresses.deployer, addresses.u2, 2);
        await hypeHaus.transferFrom(addresses.deployer, addresses.u3, 3);
        await hypeHaus.transferFrom(addresses.deployer, addresses.u4, 4);

        expect(await hypeHaus.ownerOf(0)).to.eq(addresses.u1);
        expect(await hypeHaus.ownerOf(1)).to.eq(addresses.u1);
        expect(await hypeHaus.ownerOf(2)).to.eq(addresses.u2);
        expect(await hypeHaus.ownerOf(3)).to.eq(addresses.u3);
        expect(await hypeHaus.ownerOf(4)).to.eq(addresses.u4);
      });
    });

    describe('Community Sale', () => {
      beforeEach(async () => {
        await hypeHaus.setActiveSale(HypeHausSale.Community);
        await hypeHaus.setAlphaMerkleRoot(tree.getHexRoot());
        await hypeHaus.setHypelisterMerkleRoot(tree.getHexRoot());
        await hypeHaus.setHypememberMerkleRoot(tree.getHexRoot());
      });

      it('mints valid amount as Alpha', async () => {
        for (
          let amount = 1, index = 0;
          amount <= MAX_MINT_ALPHA;
          amount++, index++
        ) {
          await expectSuccessfulCommunityMint(
            index,
            amount,
            (hypeHaus, amount, proof, overrides) =>
              hypeHaus.mintAlpha(amount, proof, overrides),
          );
        }
      });

      it('mints valid amount as Hypelister', async () => {
        for (
          let amount = 1, index = 0;
          amount <= MAX_MINT_HYPELISTER;
          amount++, index++
        ) {
          await expectSuccessfulCommunityMint(
            index,
            amount,
            (hypeHaus, amount, proof, overrides) =>
              hypeHaus.mintHypelister(amount, proof, overrides),
          );
        }
      });

      it('mints valid amount as Hypemember', async () => {
        for (
          let amount = 1, index = 0;
          amount <= MAX_MINT_HYPEMEMBER;
          amount++, index++
        ) {
          await expectSuccessfulCommunityMint(
            index,
            amount,
            (hypeHaus, amount, proof, overrides) =>
              hypeHaus.mintHypemember(amount, proof, overrides),
          );
        }
      });
    });

    describe('Public Sale', () => {
      beforeEach(async () => {
        await hypeHaus.setActiveSale(HypeHausSale.Public);
      });

      it('mints valid amount as public member', async () => {
        for (let amount = 1, i = 0; amount <= MAX_MINT_PUBLIC; amount++, i++) {
          const signer = signers[i];
          const previousTotal = await hypeHaus.totalMinted();
          const overrides = { value: PUBLIC_SALE_PRICE.mul(amount) };
          await expect(hypeHaus.connect(signer).mintPublic(amount, overrides))
            .to.emit(hypeHaus, 'Transfer')
            .withArgs(ethers.constants.AddressZero, signer.address, i);
          const currentTotal = await hypeHaus.totalMinted();
          const expectedTotal = previousTotal.add(amount);
          expect(currentTotal).to.eq(expectedTotal);
        }
      });
    });
  });

  describe('Token URI and Owner', () => {
    it('reports mask base token URI on initialization', async () => {
      await hypeHaus.setActiveSale(HypeHausSale.Public);
      await hypeHaus.mintPublic(2, { value: PUBLIC_SALE_PRICE.mul(2) });

      expect(await hypeHaus.tokenURI(0)).to.eq(`${MASKED_BASE_TOKEN_URI}0`);
      expect(await hypeHaus.tokenURI(1)).to.eq(`${MASKED_BASE_TOKEN_URI}1`);

      await hypeHaus.setBaseTokenURI(REVEALED_BASE_TOKEN_URI, true);
      expect(await hypeHaus.tokenURI(0)).to.eq(
        `${REVEALED_BASE_TOKEN_URI}0.json`,
      );
      expect(await hypeHaus.tokenURI(1)).to.eq(
        `${REVEALED_BASE_TOKEN_URI}1.json`,
      );
    });

    it('can reveal real base URI of minted tokens', async () => {
      await hypeHaus.setActiveSale(HypeHausSale.Public);

      const minters = [signers.u1, signers.u2, signers.u3, signers.u4];
      await Promise.all(
        minters.map(async (minter) => {
          await hypeHaus
            .connect(minter)
            .mintPublic(MAX_MINT_PUBLIC, { value: PUBLIC_SALE_PRICE.mul(2) });
        }),
      );

      await Promise.all(
        [...Array(minters.length)].map(async (_, i) => {
          expect(await hypeHaus.tokenURI(i)).to.eq(
            `${MASKED_BASE_TOKEN_URI}${i}`,
          );
        }),
      );

      await hypeHaus.setBaseTokenURI(REVEALED_BASE_TOKEN_URI, true);
      await Promise.all(
        [...Array(minters.length)].map(async (_, i) => {
          expect(await hypeHaus.tokenURI(i)).to.eq(
            `${REVEALED_BASE_TOKEN_URI}${i}.json`,
          );
        }),
      );
    });

    it('reports correct URI and owner of given minted token', async () => {
      // Alpha Merkle Tree
      const alphas = [addresses.u1].map(keccak256);
      const alphaTree = new MerkleTree(alphas, keccak256, { sortPairs: true });
      const alphaRoot = alphaTree.getHexRoot();
      const alphaProof = alphaTree.getHexProof(alphas[0]);
      await hypeHaus.setAlphaMerkleRoot(alphaRoot);

      // Hypelist Merkle Tree
      const hlLeaves = [addresses.u2].map(keccak256);
      const hlTree = new MerkleTree(hlLeaves, keccak256, { sortPairs: true });
      const hlRoot = hlTree.getHexRoot();
      const hlProof = hlTree.getHexProof(hlLeaves[0]);
      await hypeHaus.setHypelisterMerkleRoot(hlRoot);

      // Hypemember Merkle Tree
      const hmLeaves = [addresses.u3].map(keccak256);
      const hmTree = new MerkleTree(hmLeaves, keccak256, { sortPairs: true });
      const hmRoot = hmTree.getHexRoot();
      const hmProof = hmTree.getHexProof(hmLeaves[0]);
      await hypeHaus.setHypememberMerkleRoot(hmRoot);

      // Activate community sale
      await hypeHaus.setActiveSale(HypeHausSale.Community);
      const communityMintOverrides = {
        value: COMMUNITY_SALE_PRICE.mul(MAX_MINT_ALPHA),
      };

      await hypeHaus
        .connect(signers.u1)
        .mintAlpha(MAX_MINT_ALPHA, alphaProof, communityMintOverrides);

      await hypeHaus
        .connect(signers.u2)
        .mintHypelister(MAX_MINT_HYPELISTER, hlProof, communityMintOverrides);

      await hypeHaus
        .connect(signers.u3)
        .mintHypemember(MAX_MINT_HYPEMEMBER, hmProof, communityMintOverrides);

      // Activate public sale
      await hypeHaus.setActiveSale(HypeHausSale.Public);
      await hypeHaus
        .connect(signers.u1)
        .mintPublic(2, { value: PUBLIC_SALE_PRICE.mul(2) });
      await hypeHaus
        .connect(signers.u4)
        .mintPublic(1, { value: PUBLIC_SALE_PRICE });

      // Test all token URIs
      await hypeHaus.setBaseTokenURI(REVEALED_BASE_TOKEN_URI, true);
      await Promise.all(
        [...Array(8)].map(async (_, i) => {
          expect(await hypeHaus.tokenURI(i)).to.eq(
            `${REVEALED_BASE_TOKEN_URI}${i}.json`,
          );
        }),
      );

      // Test all token owners
      expect(await hypeHaus.ownerOf(0)).to.eq(addresses.u1);
      expect(await hypeHaus.ownerOf(1)).to.eq(addresses.u1);
      expect(await hypeHaus.ownerOf(2)).to.eq(addresses.u1);
      expect(await hypeHaus.ownerOf(3)).to.eq(addresses.u2);
      expect(await hypeHaus.ownerOf(4)).to.eq(addresses.u2);
      expect(await hypeHaus.ownerOf(5)).to.eq(addresses.u3);
      expect(await hypeHaus.ownerOf(6)).to.eq(addresses.u1);
      expect(await hypeHaus.ownerOf(7)).to.eq(addresses.u1);
      expect(await hypeHaus.ownerOf(8)).to.eq(addresses.u4);

      // Expect all token URIs to have changed when setting a new base token URI
      const newBaseTokenURI = 'test://zyx987/';
      await hypeHaus.setBaseTokenURI(newBaseTokenURI, true);
      await Promise.all(
        [...Array(8)].map(async (_, i) => {
          expect(await hypeHaus.tokenURI(i)).to.eq(
            `${newBaseTokenURI}${i}.json`,
          );
        }),
      );
    });

    it('can change base token URI for all minted HYPEHAUSes', async () => {
      const newBaseTokenURI = 'protocol://zyxw9876/';
      await hypeHaus.setBaseTokenURI(REVEALED_BASE_TOKEN_URI, true);
      await hypeHaus.setActiveSale(HypeHausSale.Public);

      await hypeHaus
        .connect(signers.u1)
        .mintPublic(1, { value: PUBLIC_SALE_PRICE });
      await hypeHaus
        .connect(signers.u2)
        .mintPublic(1, { value: PUBLIC_SALE_PRICE });

      expect(await hypeHaus.tokenURI(0)).to.eq(
        `${REVEALED_BASE_TOKEN_URI}0.json`,
      );
      expect(await hypeHaus.tokenURI(1)).to.eq(
        `${REVEALED_BASE_TOKEN_URI}1.json`,
      );

      await hypeHaus.setBaseTokenURI(newBaseTokenURI, true);
      expect(await hypeHaus.tokenURI(0)).to.eq(`${newBaseTokenURI}0.json`);
      expect(await hypeHaus.tokenURI(1)).to.eq(`${newBaseTokenURI}1.json`);
    });
  });

  describe('Withdrawing', () => {
    it("withdraws balance into designated team's wallet", async () => {
      await hypeHaus.setActiveSale(HypeHausSale.Public);

      // Helper functions
      const getBalance = (signer: SignerName) => signers[signer].getBalance();
      const mintTokenAs = async (signer: SignerWithAddress) => {
        return await hypeHaus
          .connect(signer)
          .mintPublic(1, { value: PUBLIC_SALE_PRICE })
          .then((tx) => tx.wait())
          .then((receipt) => receipt.gasUsed.mul(receipt.effectiveGasPrice));
      };

      // Initial balance state
      const initialBalances = {
        u1: await getBalance('u1'),
        u2: await getBalance('u2'),
        team: await getBalance('team'),
      };

      // First, mint one token each token for u1 and u2.
      const totalGasUsedClient1 = await mintTokenAs(signers.u1);
      const totalGasUsedClient2 = await mintTokenAs(signers.u2);

      // Next, check that the given client balances is equal to the expected
      // balances.
      const givenClient1Balance = await getBalance('u1');
      const givenClient2Balance = await getBalance('u2');

      const expectedClient1Balance = initialBalances.u1
        .sub(PUBLIC_SALE_PRICE)
        .sub(totalGasUsedClient1);
      const expectedClient2Balance = initialBalances.u2
        .sub(PUBLIC_SALE_PRICE)
        .sub(totalGasUsedClient2);

      expect(givenClient1Balance).to.eq(expectedClient1Balance);
      expect(givenClient2Balance).to.eq(expectedClient2Balance);
      expect(await getBalance('team')).to.eq(initialBalances.team);

      // Finally, withdraw the pending balance into the team's wallet and check
      // that the team's new balance is equal to the initial balance plus the
      // sum of u1 and u2's payments (0.08 ether each).
      await hypeHaus.withdraw();
      const expectedTeamBalance = initialBalances.team.add(
        PUBLIC_SALE_PRICE.mul(2),
      );
      expect(await getBalance('team')).to.eq(expectedTeamBalance);

      // The client balances should not have changed when withdrawing.
      expect(await getBalance('u1')).to.eq(givenClient1Balance);
      expect(await getBalance('u2')).to.eq(givenClient2Balance);
    });
  });

  describe('Access Control', () => {
    let adminRole: string;
    let operatorRole: string;
    let withdrawerRole: string;

    beforeEach(async () => {
      adminRole = await hypeHaus.DEFAULT_ADMIN_ROLE();
      operatorRole = await hypeHaus.OPERATOR_ROLE();
      withdrawerRole = await hypeHaus.WITHDRAWER_ROLE();
    });

    it('reports deployer has admin role at initialization', async () => {
      const deployer = addresses.deployer;
      expect(await hypeHaus.hasGivenOrAdminRole(adminRole, deployer));
      expect(await hypeHaus.hasGivenOrAdminRole(operatorRole, deployer));
      expect(await hypeHaus.hasGivenOrAdminRole(withdrawerRole, deployer));
    });

    it('reports the deployer as the owner for OpenSea', async () => {
      const { deployer } = addresses;
      expect(await hypeHaus.owner()).to.eq(deployer);
    });

    it('can grant and revoke roles for accounts', async () => {
      const { deployer, u1: user1, u2: user2 } = addresses;

      // Deployer

      await hypeHaus.revokeRole(withdrawerRole, deployer);
      expect(!(await hypeHaus.hasGivenOrAdminRole(withdrawerRole, user1)));

      // User 1

      expect(!(await hypeHaus.hasGivenOrAdminRole(operatorRole, user1)));
      expect(!(await hypeHaus.hasGivenOrAdminRole(adminRole, user1)));
      expect(!(await hypeHaus.hasGivenOrAdminRole(withdrawerRole, user1)));

      await hypeHaus.grantRole(operatorRole, user1);
      expect(await hypeHaus.hasGivenOrAdminRole(operatorRole, user1));
      expect(!(await hypeHaus.hasGivenOrAdminRole(adminRole, user1)));
      expect(!(await hypeHaus.hasGivenOrAdminRole(withdrawerRole, user1)));

      await hypeHaus.grantRole(withdrawerRole, user1);
      expect(await hypeHaus.hasGivenOrAdminRole(withdrawerRole, user1));

      await hypeHaus.revokeRole(operatorRole, user1);
      expect(!(await hypeHaus.hasGivenOrAdminRole(operatorRole, user1)));

      // User 2

      expect(!(await hypeHaus.hasGivenOrAdminRole(operatorRole, user2)));
      expect(!(await hypeHaus.hasGivenOrAdminRole(adminRole, user2)));
      expect(!(await hypeHaus.hasGivenOrAdminRole(withdrawerRole, user2)));

      await hypeHaus.grantRole(withdrawerRole, user2);
      expect(!(await hypeHaus.hasGivenOrAdminRole(withdrawerRole, user2)));
    });

    it('fails to call function with insufficient privileges', async () => {
      await hypeHaus.grantRole(withdrawerRole, signers.u1.address);
      await hypeHaus.grantRole(operatorRole, signers.u2.address);

      await expect(
        hypeHaus.connect(signers.u1).withdraw(),
      ).to.not.be.revertedWith(
        HypeHausAccessControlErrorCode.CallerNotWithdrawer,
      );
      await expect(hypeHaus.connect(signers.u2).withdraw()).to.be.revertedWith(
        HypeHausAccessControlErrorCode.CallerNotWithdrawer,
      );

      await expect(
        hypeHaus.connect(signers.u2).setActiveSale(HypeHausSale.Community),
      ).to.not.be.revertedWith(
        HypeHausAccessControlErrorCode.CallerNotOperator,
      );
      await expect(
        hypeHaus.connect(signers.u1).setActiveSale(HypeHausSale.Community),
      ).to.be.revertedWith(HypeHausAccessControlErrorCode.CallerNotOperator);
    });
  });
});

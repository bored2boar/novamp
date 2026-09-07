/**
 * The slice of pons v2 novamp reads.
 *
 * Read only by construction: there is no `buy`, no `sell`, no `claim` and no
 * approval in this file, and CI fails the build if a write primitive appears
 * anywhere in `src/`. Sources: docs.ponsfamily.com/v2 and the verified factory
 * and curve ABIs on Blockscout.
 */

import { parseAbi, parseAbiItem, toEventSelector } from "viem";

export const factoryAbi = parseAbi([
  "struct LaunchedToken { address token; address curve; address deployer; address creatorFeeRecipient; address pairToken; uint256 graduationThreshold; uint24 poolFee; int24 tickSpacing; uint16 creatorTaxBps; bool buybackEnabled; uint8 phase; uint256 sweptQuote; uint256 sweptTokens; uint256 sweptAt; bool exists; }",
  "function getLaunchedToken(address token) view returns (LaunchedToken)",
  "function snipeTaxStartBps() view returns (uint256)",
  "function snipeTaxSeconds() view returns (uint256)",
  "function maxCreatorTaxBps() view returns (uint256)",
  "function feeEscrow() view returns (address)",
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
  "event LaunchSwept(address indexed token, uint256 quoteOut, uint256 tokenOut)",
  "event PoolGraduated(address indexed token, uint256 positionId, uint256 tokenAmount, uint256 pairTokenAmount)",
]);

export const curveAbi = parseAbi([
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function launchedAt() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function snipeTaxExempt(address account) view returns (bool)",
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
]);

export const tokenAbi = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

/**
 * Single event items, for `getLogs({ event })`.
 *
 * viem decodes the args for us when the event is passed this way, which removes
 * a whole class of "decoded the wrong topic" bugs from the readers.
 */
export const tokenLaunchedEvent = parseAbiItem(
  "event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 launchConfigId, uint256 graduationThreshold)",
);
export const curveBuyEvent = parseAbiItem(
  "event CurveBuy(address indexed buyer, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 tax)",
);
export const curveSellEvent = parseAbiItem(
  "event CurveSell(address indexed seller, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 tax)",
);
export const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export const TOPIC = {
  tokenLaunched: toEventSelector(
    "TokenLaunched(address,address,address,address,uint256,uint256)",
  ),
  curveBuy: toEventSelector("CurveBuy(address,address,uint256,uint256,uint256,uint256)"),
  curveSell: toEventSelector("CurveSell(address,address,uint256,uint256,uint256,uint256)"),
  transfer: toEventSelector("Transfer(address,address,uint256)"),
  poolGraduated: toEventSelector("PoolGraduated(address,uint256,uint256,uint256)"),
} as const;

export const BPS = 10_000n;

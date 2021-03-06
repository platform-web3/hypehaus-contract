export enum HypeHausErrorCode {
  AlreadyClaimed = 'HH_ALREADY_CLAIMED',
  CommunitySaleNotActive = 'HH_COMMUNITY_SALE_NOT_ACTIVE',
  InsufficientFunds = 'HH_INSUFFICIENT_FUNDS',
  InvalidMintAmount = 'HH_INVALID_MINT_AMOUNT',
  PublicSaleNotActive = 'HH_PUBLIC_SALE_NOT_ACTIVE',
  SupplyExhausted = 'HH_SUPPLY_EXHAUSTED',
  VerificationFailure = 'HH_VERIFICATION_FAILURE',
}

export enum HypeHausAccessControlErrorCode {
  CallerNotAdmin = 'HH_CALLER_NOT_ADMIN',
  CallerNotOperator = 'HH_CALLER_NOT_OPERATOR',
  CallerNotWithdrawer = 'HH_CALLER_NOT_WITHDRAWER',
}

export enum HypeHausSale {
  Closed = 0,
  Community = 1,
  Public = 2,
}

export function stringToHypeHausSale(sale: string): HypeHausSale {
  let hypeHausSale: HypeHausSale;

  switch (sale.trim().toLowerCase()) {
    case 'closed':
      hypeHausSale = HypeHausSale.Closed;
      break;
    case 'community':
      hypeHausSale = HypeHausSale.Community;
      break;
    case 'public':
      hypeHausSale = HypeHausSale.Public;
      break;
    default:
      throw new Error(`Invalid sale: "${sale}"`);
  }

  return hypeHausSale;
}

// tests/unit/agents/intel/hunter.test.ts

import { HunterAgent } from '../../../src/agents/intel/hunter';
import { mockScrapedProduct, mockEnrichedProduct } from '../../fixtures';

describe('HUNTER Agent', () => {
  let hunter: HunterAgent;
  
  beforeEach(async () => {
    hunter = new HunterAgent(mockDNA, mockExecutor);
    await hunter.initialize(mockConfig);
  });
  
  describe('calculateHunterScore', () => {
    it('should score high margin + high demand product above 80', async () => {
      const product = mockScrapedProduct({
        price: 50,
        cost: 15,  // 70% margin
        category: 'trending',
        searchVolume: 100000
      });
      
      const result = await hunter.calculateHunterScore(product);
      
      expect(result.total).toBeGreaterThan(80);
      expect(result.breakdown.margin).toBeGreaterThan(0.6);
    });
    
    it('should flag saturated market with low competition score', async () => {
      const product = mockScrapedProduct({
        competitorCount: 500,
        avgCompetitorPrice: 45  // Price war
      });
      
      const result = await hunter.calculateHunterScore(product);
      
      expect(result.breakdown.competition).toBeLessThan(0.3);
    });
  });
  
  describe('execute', () => {
    it('should return top 10 products by default', async () => {
      const task = { targetPlatform: 'amazon', limit: 10 };
      
      const result = await hunter.execute(task);
      
      expect(result.products).toHaveLength(10);
      expect(result.metadata.scanned).toBeGreaterThan(100);
    });
    
    it('should respect execution timeout', async () => {
      const task = { timeoutMs: 5000 };
      
      await expect(
        hunter.execute(task)
      ).rejects.toThrow(AgentTimeoutError);
    });
  });
});
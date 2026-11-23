const mockRouter = { canDismiss: jest.fn(), dismissAll: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ router: mockRouter }));

const { resetToLogin } = require('../src/utils/session-navigation');

beforeEach(() => jest.clearAllMocks());

it('dismisses the protected screens before showing the access screen', () => {
  mockRouter.canDismiss.mockReturnValue(true);
  resetToLogin('session_expired');
  expect(mockRouter.dismissAll).toHaveBeenCalledTimes(1);
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/', params: { notice: 'session_expired' } });
});

it('does not pop an empty stack (no POP_TO_TOP warning on the root screen)', () => {
  mockRouter.canDismiss.mockReturnValue(false);
  resetToLogin();
  expect(mockRouter.dismissAll).not.toHaveBeenCalled();
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/' });
});

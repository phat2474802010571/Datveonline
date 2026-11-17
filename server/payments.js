
const validCode = code =>
  typeof code === 'string' &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(code);

export function installPayments(
  app,
  { events, requireLogin, requireAdmin, requireCustomer }
) {
  // Công khai thông tin nhận tiền
  app.get('/api/payments/config', (req, res) => {
    res.json({
      bank: {
        name: process.env.BANK_NAME || '',
        account: process.env.BANK_ACCOUNT || '',
        owner: process.env.BANK_OWNER || ''
      },
      momo: {
        phone: process.env.MOMO_RECEIVER_PHONE || '',
        owner: process.env.MOMO_RECEIVER_NAME || ''
      }
    });
  });

  // Khách gửi thông báo đã chuyển tiền
  app.post(
    '/api/payments/:code/submit',
    requireLogin,
    requireCustomer,
    async (req, res, next) => {
      try {
        const code = String(
          req.params.code || ''
        ).toUpperCase();

        const method = req.body?.method;

        if (
          !validCode(code) ||
          !['bank', 'momo'].includes(method)
        ) {
          return res.status(400).json({
            message: 'Mã đơn hoặc phương thức không hợp lệ.'
          });
        }

        const configured = method === 'bank'
          ? (
              process.env.BANK_NAME &&
              process.env.BANK_ACCOUNT &&
              process.env.BANK_OWNER
            )
          : (
              process.env.MOMO_RECEIVER_PHONE &&
              process.env.MOMO_RECEIVER_NAME
            );

        if (!configured) {
          return res.status(503).json({
            message: 'Phương thức thanh toán chưa được cấu hình.'
          });
        }

        const result = await events.updateOne(
          {
            orders: {
              $elemMatch: {
                code,
                customerId: req.user.id,
                'payment.status': { $ne: 'paid' }
              }
            }
          },
          {
            $set: {
              'orders.$.payment': {
                method,
                status: 'pending_review',
                submittedAt: new Date()
              }
            }
          }
        );

        if (!result.modifiedCount) {
          return res.status(409).json({
            message: 'Không tìm thấy đơn hoặc đơn đã thanh toán.'
          });
        }

        res.json({
          ok: true,
          message: 'Đã gửi yêu cầu đối chiếu thanh toán.'
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // Admin xác nhận sau khi kiểm tra tiền thực nhận
  app.post(
    '/api/admin/payments/:code/confirm',
    requireLogin,
    requireAdmin,
    async (req, res, next) => {
      try {
        const code = String(
          req.params.code || ''
        ).toUpperCase();

        if (!validCode(code)) {
          return res.status(400).json({
            message: 'Mã vé không hợp lệ.'
          });
        }

        const result = await events.updateOne(
          {
            orders: {
              $elemMatch: {
                code,
                'payment.status': 'pending_review'
              }
            }
          },
          {
            $set: {
              'orders.$.payment.status': 'paid',
              'orders.$.payment.paidAt': new Date(),
              'orders.$.payment.confirmedBy': req.user.id
            }
          }
        );

        if (!result.modifiedCount) {
          return res.status(409).json({
            message: 'Đơn chưa chờ duyệt hoặc đã xác nhận.'
          });
        }

        res.json({
          ok: true,
          message: 'Đã ghi nhận thanh toán.'
        });
      } catch (error) {
        next(error);
      }
    }
  );
}

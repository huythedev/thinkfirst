'use client';

import { useTranslation } from '@/lib/i18n/client';

export default function TeacherGuidePage() {
  const { t, lang } = useTranslation();

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-foreground">{t('guide.teacherTitle')}</h1>
      </header>

      {lang === 'vi' ? (
        <div className="space-y-6 text-foreground leading-relaxed">
          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Làm quen với ThinkFirst</h2>
            <p className="mb-4">
              ThinkFirst giúp học sinh tự tư duy thay vì chỉ cung cấp đáp án. Để bắt đầu, bạn có thể tạo Lớp học, 
              nhận mã tham gia (Join Code) và mời học sinh vào lớp.
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Triết lý giảng dạy</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Cố gắng trước khi nhận trợ giúp:</strong> Học sinh luôn được khuyến khích thử thách bản thân trước.</li>
              <li><strong>Gợi ý vừa đủ:</strong> AI cung cấp gợi ý tiến triển từ khái quát đến chi tiết.</li>
              <li><strong>Kiểm tra độ hiểu bài:</strong> Học sinh có thể được yêu cầu làm bài tập tương tự (Transfer Problem) để chứng minh mình thực sự hiểu bài.</li>
            </ul>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Phân tích dữ liệu (Analytics)</h2>
            <p className="mb-2">
              Các chỉ số thống kê giúp bạn hiểu được tiến độ của lớp:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Điểm Độc lập:</strong> Đo lường việc học sinh cần bao nhiêu gợi ý. Đây không phải là điểm số đánh giá năng lực hay điểm số chính thức.</li>
              <li><strong>Độ thành công chuyển giao (Transfer Success):</strong> Tỷ lệ học sinh tự giải quyết được bài toán tương tự sau khi được hướng dẫn.</li>
            </ul>
            <p className="mt-2 text-sm text-foreground-muted">Lưu ý: Không dùng việc sử dụng gợi ý làm tiêu chí đánh giá tiêu cực đối với học sinh.</p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Quyền riêng tư của học sinh</h2>
            <p className="mb-4">
              ThinkFirst tập trung vào các bản tóm tắt học tập tổng hợp và những hiểu lầm thường gặp (misconceptions) 
              thay vì giám sát từng dòng tin nhắn riêng tư. Điều này tạo môi trường an toàn để học sinh thoải mái đặt câu hỏi ngớ ngẩn nhất mà không sợ bị phán xét.
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Cài đặt ngôn ngữ</h2>
            <p className="mb-2">
              Bạn có thể thay đổi giao diện giữa Tiếng Việt và Tiếng Anh trong phần <a href="/teacher/settings" className="text-blue-600 underline">Cài đặt</a>.
            </p>
          </section>
        </div>
      ) : (
        <div className="space-y-6 text-foreground leading-relaxed">
          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Getting Started</h2>
            <p className="mb-4">
              ThinkFirst helps students think rather than just giving them the answer. To start, create a Classroom, 
              get the join code, and invite your students.
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">ThinkFirst&apos;s teaching philosophy</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Attempt before help:</strong> Students are asked to try before receiving substantial assistance.</li>
              <li><strong>Minimum sufficient help:</strong> Progressive hints are used to avoid over-explaining.</li>
              <li><strong>Transfer practice:</strong> Students may be asked to solve a similar problem without help to prove mastery.</li>
            </ul>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Analytics</h2>
            <p className="mb-2">
              Metrics help you understand class progress:
            </p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Independence Score:</strong> Measures how much scaffolding a student relies on. It is not an intelligence score or an official grade.</li>
              <li><strong>Transfer Success:</strong> How often students can independently solve a similar problem after guided help.</li>
            </ul>
            <p className="mt-2 text-sm text-foreground-muted">Note: Hint usage should not be interpreted negatively. Seeking help is part of learning.</p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Student privacy</h2>
            <p className="mb-4">
              ThinkFirst emphasizes aggregate learning insights and misconceptions rather than unrestricted surveillance 
              of private student conversations. This creates a safe space for students to ask &quot;silly&quot; questions.
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Language Settings</h2>
            <p className="mb-2">
              You can switch the interface between English and Tiếng Việt in your <a href="/teacher/settings" className="text-blue-600 underline">Settings</a>.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

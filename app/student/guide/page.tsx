'use client';

import { useTranslation } from '@/lib/i18n/client';

export default function StudentGuidePage() {
  const { t, lang } = useTranslation();

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-foreground">{t('guide.studentTitle')}</h1>
      </header>

      {lang === 'vi' ? (
        <div className="space-y-6 text-foreground leading-relaxed">
          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Chào mừng đến với ThinkFirst</h2>
            <p className="mb-4">
              ThinkFirst không phải là một công cụ giải bài tập tự động. Đây là gia sư AI được thiết kế để giúp bạn học cách tự suy nghĩ và giải quyết vấn đề.
              Thay vì đưa ra câu trả lời ngay lập tức, gia sư sẽ hướng dẫn bạn từng bước.
            </p>
            <p>
              Mục tiêu là giúp bạn trở nên <strong>độc lập</strong> hơn.
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Một phiên học diễn ra như thế nào?</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Thử thách:</strong> Bạn luôn nên cố gắng thử làm trước.</li>
              <li><strong>Nhận nhận xét:</strong> Nếu bạn làm sai, AI sẽ gợi ý bạn kiểm tra lại bước đó.</li>
              <li><strong>Dùng gợi ý:</strong> Nếu bạn bí, hãy nhờ gợi ý.</li>
              <li><strong>Kiểm tra kết quả:</strong> Khi hoàn thành, AI có thể cho bạn một câu hỏi tương tự để kiểm tra độ hiểu bài của bạn.</li>
            </ul>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Gợi ý hoạt động ra sao?</h2>
            <p className="mb-4">
              Các gợi ý được đưa ra từ nhỏ đến lớn. Đầu tiên, AI có thể chỉ cho bạn một hướng đi chung chung. 
              Nếu bạn vẫn không thể tự làm, AI sẽ cung cấp thêm thông tin ở các gợi ý tiếp theo. 
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Cách nhờ AI giúp đỡ hiệu quả</h2>
            <p className="mb-4">Bạn có thể hỏi những câu như:</p>
            <ul className="list-disc pl-5 space-y-2 text-blue-800 bg-blue-50 p-4 rounded-lg">
              <li>&quot;Mình làm đến đây rồi. Bước này đúng không?&quot;</li>
              <li>&quot;Tại sao lại dùng công thức này?&quot;</li>
              <li>&quot;Bạn có thể cho mình một gợi ý nhỏ được không?&quot;</li>
              <li>&quot;Giải thích theo cách khác dễ hiểu hơn đi.&quot;</li>
              <li>&quot;Mình nghĩ bạn tính sai rồi, hãy kiểm tra lại nhé.&quot;</li>
            </ul>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Điểm Độc lập là gì?</h2>
            <p className="mb-2">
              Điểm Độc lập cho bạn biết khả năng tự giải quyết vấn đề của bạn đang ở mức nào. 
              Đây <strong>không phải</strong> là điểm số để xếp hạng hay đánh giá thông minh, mà là 
              một thước đo giúp bạn theo dõi tiến bộ của mình.
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Cài đặt Ngôn ngữ</h2>
            <p className="mb-2">
              Bạn có thể chuyển đổi giao diện và ngôn ngữ giảng giải của gia sư AI 
              giữa Tiếng Anh và Tiếng Việt trong phần <a href="/student/settings" className="text-blue-600 underline">Cài đặt</a>.
            </p>
          </section>
        </div>
      ) : (
        <div className="space-y-6 text-foreground leading-relaxed">
          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Welcome to ThinkFirst</h2>
            <p className="mb-4">
              ThinkFirst is not an answer engine. It is an AI tutor designed to help you think and solve problems on your own.
              Instead of giving you the final answer immediately, it guides you step by step.
            </p>
            <p>
              The goal is to help you become more <strong>independent</strong>.
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">How a learning session works</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>Try:</strong> Always attempt the step first.</li>
              <li><strong>Get feedback:</strong> If you make a mistake, the AI will point it out gently.</li>
              <li><strong>Use a hint:</strong> If you&apos;re stuck, ask for a hint.</li>
              <li><strong>Check the result:</strong> You may be given a similar transfer problem at the end to prove you understood it.</li>
            </ul>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">How hints work</h2>
            <p className="mb-4">
              Hints are progressive. Smaller hints come first. If you still don&apos;t get it, 
              more help becomes available. The goal is to give you just enough help to get unstuck.
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">How to ask for help</h2>
            <p className="mb-4">You can say things like:</p>
            <ul className="list-disc pl-5 space-y-2 text-blue-800 bg-blue-50 p-4 rounded-lg">
              <li>&quot;I tried this step. Is it correct?&quot;</li>
              <li>&quot;I don&apos;t understand why this formula applies.&quot;</li>
              <li>&quot;Can you give me a smaller hint?&quot;</li>
              <li>&quot;Can you explain this in another way?&quot;</li>
              <li>&quot;I think the AI might be wrong. Can you check my reasoning?&quot;</li>
            </ul>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Independence Score</h2>
            <p className="mb-2">
              This score indicates how much help you usually need. It is <strong>not</strong> an intelligence ranking 
              or an official grade. It simply measures your learning progress towards independence.
            </p>
          </section>

          <section className="bg-surface p-6 rounded-2xl shadow-sm border border-border">
            <h2 className="text-xl font-bold mb-4">Language Settings</h2>
            <p className="mb-2">
              You can switch the interface and tutor language between English and Vietnamese 
              in your <a href="/student/settings" className="text-blue-600 underline">Settings</a>.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}

import { Field } from './sections';
import { NativeSelect } from '@/components/ui/native-select';
import type { Task } from '@/lib/domain';
import { useState } from 'react';
export default function TaskFields({
  selectedTask,
  editTime,
}: {
  selectedTask: Task | null;
  editTime: string;
}) {
  const rule = selectedTask?.recurrence_json
    ? (JSON.parse(selectedTask.recurrence_json) as {
        mode: string;
        every: number;
        day: number;
      })
    : null;
  const [repeat, setRepeat] = useState(rule?.mode || 'none');
  return (
    <>
      <Field label="Что нужно сделать?">
        <input
          required
          maxLength={160}
          name="title"
          placeholder="Например, подготовить предложение"
          defaultValue={selectedTask?.title}
        />
      </Field>
      <details className="task-options">
        <summary>Дополнительные параметры</summary>
        <div className="form-pair">
          <Field label="Тип работы">
            <NativeSelect
              name="brain_hemisphere"
              defaultValue={selectedTask?.brain_hemisphere || 'analytical'}
            >
              <option value="analytical">Аналитика</option>
              <option value="creative">Творчество</option>
            </NativeSelect>
          </Field>
          <Field label="Энергия · 1–10">
            <input
              name="required_energy"
              required
              type="number"
              min="1"
              max="10"
              defaultValue={selectedTask?.required_energy || 5}
            />
          </Field>
        </div>
        <Field label="Оценка времени · минуты">
          <input
            name="estimated_minutes"
            type="number"
            min="1"
            max="1440"
            required
            defaultValue={selectedTask?.estimated_minutes || 30}
          />
        </Field>
        <Field label="Срок · необязательно">
          <input
            name="deadline"
            type="datetime-local"
            defaultValue={editTime}
          />
        </Field>
        <Field label="Метки · через запятую">
          <input
            name="tags"
            maxLength={480}
            placeholder="Работа, Дом"
            defaultValue={(
              JSON.parse(selectedTask?.tags_json || '[]') as string[]
            ).join(', ')}
          />
        </Field>
        <Field label="Повторять">
          <NativeSelect
            name="repeat_mode"
            value={repeat}
            onChange={(e) => setRepeat(e.target.value)}
          >
            <option value="none">Не повторять</option>
            <option value="days">Каждые N дней по расписанию</option>
            <option value="monthly">Каждые N месяцев</option>
            <option value="after">Через N дней после выполнения</option>
          </NativeSelect>
        </Field>
        {repeat !== 'none' && (
          <>
            <div className="form-pair">
              <Field
                label={
                  repeat === 'monthly'
                    ? 'Интервал · месяцев'
                    : 'Интервал · дней'
                }
              >
                <input
                  name="repeat_every"
                  type="number"
                  min={1}
                  max={repeat === 'monthly' ? 24 : 365}
                  defaultValue={rule?.every || (repeat === 'days' ? 7 : 1)}
                  required
                />
              </Field>
              {repeat === 'monthly' && (
                <Field label="Число месяца">
                  <input
                    name="repeat_day"
                    type="number"
                    min={1}
                    max={31}
                    defaultValue={rule?.day || 1}
                    required
                  />
                </Field>
              )}
            </div>
            <p className="footnote">
              Следующая задача появится после завершения текущей. Пропущенные
              даты не создают очередь дублей.
            </p>
          </>
        )}
        <details>
          <summary>Добровольный штраф</summary>
          <Field label="Условный штраф · ₸">
            <input
              name="penalty_amount"
              inputMode="decimal"
              pattern="[0-9]{1,9}([.,][0-9]{1,2})?"
              required
              defaultValue={
                selectedTask ? String(selectedTask.penalty_minor / 100) : '0'
              }
            />
          </Field>
          <p className="footnote">
            Штраф сохраняется отдельно от бюджета. Реальные расходы появляются
            только после вашего подтверждения.
          </p>
        </details>
      </details>
    </>
  );
}

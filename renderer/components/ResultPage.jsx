import React, { useEffect, useState } from 'react';
import { Table, Button, message } from 'antd';
import { useParams, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

const fs = window.require ? window.require('fs') : null;
const path = window.require ? window.require('path') : null;
const electron = window.require ? window.require('electron') : null;

const columns = [
  { title: '行业', dataIndex: 'industry', key: 'industry' },
  { title: '股票数量', dataIndex: 'count', key: 'count' },
  { title: '成交总额（亿）', dataIndex: 'total', key: 'total' },
  { title: '日期', dataIndex: 'date', key: 'date' },
];

export default function ResultPage() {
  const { date } = useParams();
  const navigate = useNavigate();
  const [dataByDate, setDataByDate] = useState({});
  const [tableData, setTableData] = useState([]);
  const [userDataPath, setUserDataPath] = useState('');
  const [dataFile, setDataFile] = useState('');

  useEffect(() => {
    if (electron && electron.ipcRenderer) {
      electron.ipcRenderer.invoke('get-user-data-path').then((p) => {
        setUserDataPath(p);
        setDataFile(path ? path.join(p, 'data.json') : '');
        if (fs && path) {
          const filePath = path.join(p, 'data.json');
          if (fs.existsSync(filePath)) {
            try {
              const raw = fs.readFileSync(filePath, 'utf-8');
              const local = JSON.parse(raw);
              setDataByDate(local);
              if (local[date]) {
                // 按行业聚合
                const industryMap = {};
                local[date].forEach(row => {
                  const { industry, amount } = row;
                  if (!industryMap[industry]) {
                    industryMap[industry] = { industry, count: 0, total: 0 };
                  }
                  industryMap[industry].count += 1;
                  industryMap[industry].total += amount;
                });
                const result = Object.values(industryMap).map(item => ({
                  ...item,
                  total: item.total.toFixed(2),
                  date: date,
                }));
                setTableData(result);
              } else {
                setTableData([]);
              }
            } catch {
              setDataByDate({});
              setTableData([]);
            }
          }
        }
      });
    }
  }, [date]);

  // 导出当前详情页聚合数据
  const handleExport = () => {
    if (!tableData.length) return message.warning('无数据可导出');
    // 表头和数据与页面一致
    const exportData = tableData.map(row => ({
      '行业': row.industry,
      '股票数量': row.count,
      '成交总额（亿）': row.total,
      '日期': row.date,
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, date);
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    if (electron && electron.remote) {
      electron.remote.dialog.showSaveDialog({
        defaultPath: `${date}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      }).then(({ filePath }) => {
        if (filePath && fs) {
          fs.writeFileSync(filePath, Buffer.from(buf));
          message.success('导出成功');
        }
      });
    } else {
      // fallback: 浏览器下载
      const blob = new Blob([buf], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${date}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button onClick={() => navigate('/')}>返回</Button>
        <b style={{ marginLeft: 16 }}>当前数据日期：</b>{date}
        <Button style={{ marginLeft: 16 }} onClick={handleExport}>导出为Excel</Button>
      </div>
      <Table
        columns={columns}
        dataSource={tableData}
        rowKey={row => row.industry + row.date}
        pagination={false}
        locale={{ emptyText: '暂无数据' }}
      />
    </div>
  );
} 